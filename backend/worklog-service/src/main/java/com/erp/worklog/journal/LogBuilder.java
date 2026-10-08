package com.erp.worklog.journal;

import com.erp.worklog.journal.LogSources.DoneTask;
import com.erp.worklog.journal.LogSources.Rec;
import com.erp.worklog.journal.LogSources.TaskInfo;
import com.erp.worklog.journal.LogViews.Achievement;
import com.erp.worklog.journal.LogViews.Author;
import com.erp.worklog.journal.LogViews.Candidate;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Day;
import com.erp.worklog.journal.LogViews.Metrics;
import com.erp.worklog.journal.LogViews.Period;
import com.erp.worklog.journal.LogViews.Plan;
import com.erp.worklog.journal.LogViews.ProjectStat;
import com.erp.worklog.journal.WorkLogRepository.Row;
import com.erp.worklog.schedule.EndedOccurrences.Ended;
import com.erp.worklog.schedule.PlanOccurrences;
import com.erp.worklog.user.Profile;
import com.erp.worklog.workrecord.TimeQueries;
import com.erp.worklog.workrecord.TimeViews.TimeSummaryView;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * 일지 내용 만들기 (P3-03 일간 LOG-01~03·15, P3-07 주간·월간 LOG-07·08). 초안의 사용자가 고친 칸(Draft)을 받아 나머지를 원본으로 채운다.
 * 호출하는 쪽의 트랜잭션 안에서 부른다.
 */
@Component
class LogBuilder {

	static final int MAX_CANDIDATES = 20;

	/** 요청 하나 동안 같은 사용자의 값. */
	record Context(UUID ownerId, Profile profile, ZoneId zone, WorkCalendar calendar, boolean timeTracking,
			LocalDate today) {
	}

	/** 초안에 저장하는 사용자가 고친 칸. achievements가 null이면 실적은 자동(원본에서 만듦). */
	record Draft(List<Achievement> achievements, List<Plan> plans, String issues) {

		static final Draft EMPTY = new Draft(null, List.of(), null);
	}

	private final LogSources sources;
	private final TimeQueries times;
	private final PlanOccurrences occurrences;
	private final WorkLogRepository logs;
	private final JsonMapper json;

	LogBuilder(LogSources sources, TimeQueries times, PlanOccurrences occurrences, WorkLogRepository logs, JsonMapper json) {
		this.sources = sources;
		this.times = times;
		this.occurrences = occurrences;
		this.logs = logs;
		this.json = json;
	}

	Content build(Context c, LogType type, LocalDate start, Draft draft) {
		LocalDate end = type.end(start);
		List<Rec> records = sources.records(c.ownerId(), start, end);
		List<DoneTask> done = sources.completedTasks(c.ownerId(), c.zone(), start, end);
		Period planPeriod = planPeriod(c.calendar(), type, start);
		boolean auto = draft.achievements() == null;
		List<Day> days = new ArrayList<>();
		List<ProjectStat> projects = List.of();
		List<Achievement> achievements;
		if (type == LogType.DAILY) {
			achievements = auto ? autoAchievements(c, records, done) : enrich(c, draft.achievements());
		}
		else {
			List<Achievement> daily = periodAchievements(c, start, end, records, done, days);
			achievements = auto ? group(c, daily) : enrich(c, draft.achievements());
			projects = projects(c, records, done);
		}
		return new Content(type.title, author(c.profile()), auto, achievements,
				metrics(c, start, end, records, done), planTitle(type, planPeriod), planPeriod,
				plans(c, planPeriod, draft.plans()), draft.issues(), time(c, start, end), days, projects);
	}

	/**
	 * 주간·월간의 날마다 실적: 확정된 일간 일지가 있으면 그 스냅샷 실적, 없으면 그날 원본(일간과 같은 규칙). days에 출처를 채운다.
	 */
	private List<Achievement> periodAchievements(Context c, LocalDate start, LocalDate end, List<Rec> records,
			List<DoneTask> done, List<Day> days) {
		Map<LocalDate, Row> confirmed = new HashMap<>();
		for (Row r : logs.findStarting(c.ownerId(), LogType.DAILY, start, end)) {
			if (r.confirmed()) {
				confirmed.put(r.periodStart(), r);
			}
		}
		Map<LocalDate, List<Rec>> recordsByDay = new HashMap<>();
		records.forEach(r -> recordsByDay.computeIfAbsent(r.workDate(), d -> new ArrayList<>()).add(r));
		Map<LocalDate, List<DoneTask>> doneByDay = new HashMap<>();
		done.forEach(t -> doneByDay.computeIfAbsent(t.date(), d -> new ArrayList<>()).add(t));

		List<Achievement> result = new ArrayList<>();
		for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
			Row row = confirmed.get(d);
			String source;
			if (row != null) {
				List<LocalDate> day = List.of(d);
				for (Achievement a : json.readValue(row.content(), Content.class).achievements()) {
					result.add(a.dates().isEmpty() ? withDates(a, day) : a);
				}
				source = "CONFIRMED_LOG";
			}
			else {
				List<Achievement> rows = autoAchievements(c, recordsByDay.getOrDefault(d, List.of()),
						doneByDay.getOrDefault(d, List.of()));
				result.addAll(rows);
				source = rows.isEmpty() ? "NONE" : "RECORDS";
			}
			days.add(new Day(d, c.calendar().workday(d), c.calendar().holiday(d), source));
		}
		return result;
	}

	/**
	 * 업무별로 묶기 (LOG-07): 같은 업무의 줄은 처음 나온 자리에 한 줄로 — 내용은 업무 제목, 결과는 마지막으로 적은 결과,
	 * 결과 칩·진행률은 마지막 줄, 날짜·기록은 합친다. 업무 없는 줄은 그대로 한 줄씩.
	 */
	private List<Achievement> group(Context c, List<Achievement> rows) {
		Map<UUID, List<Achievement>> byTask = new LinkedHashMap<>();
		List<Object> order = new ArrayList<>();
		for (Achievement a : rows) {
			if (a.taskId() == null) {
				order.add(a);
				continue;
			}
			if (!byTask.containsKey(a.taskId())) {
				order.add(a.taskId());
			}
			byTask.computeIfAbsent(a.taskId(), k -> new ArrayList<>()).add(a);
		}
		Map<UUID, TaskInfo> tasks = sources.tasks(c.ownerId(), byTask.keySet());
		List<Achievement> grouped = new ArrayList<>();
		for (Object o : order) {
			if (o instanceof Achievement a) {
				grouped.add(a);
				continue;
			}
			UUID taskId = (UUID) o;
			List<Achievement> same = byTask.get(taskId);
			Achievement last = same.getLast();
			String result = null;
			Set<LocalDate> dates = new TreeSet<>();
			Set<UUID> recordIds = new LinkedHashSet<>();
			Integer minutes = null;
			for (Achievement a : same) {
				result = a.result() != null ? a.result() : result;
				dates.addAll(a.dates());
				recordIds.addAll(a.recordIds());
				if (a.durationMin() != null) {
					minutes = (minutes == null ? 0 : minutes) + a.durationMin();
				}
			}
			TaskInfo t = tasks.get(taskId);
			grouped.add(new Achievement(taskId, t == null ? last.text() : t.title(), result, last.outcome(), last.progress(),
					taskId, last.projectName(), List.copyOf(dates), List.copyOf(recordIds), c.timeTracking() ? minutes : null,
					recordIds.isEmpty() ? last.source() : "RECORD"));
		}
		return grouped;
	}

	/** 프로젝트별 실적 (LOG-08): 완료 업무 수·기록 수·(옵션) 소요시간. 이름순, 프로젝트 없는 업무·업무 없는 기록은 null 한 줄로 맨 뒤. */
	private List<ProjectStat> projects(Context c, List<Rec> records, List<DoneTask> done) {
		Set<UUID> taskIds = new HashSet<>();
		records.stream().map(Rec::taskId).filter(Objects::nonNull).forEach(taskIds::add);
		Map<UUID, TaskInfo> tasks = sources.tasks(c.ownerId(), taskIds);
		Map<UUID, int[]> stats = new HashMap<>(); // [완료 업무, 기록, 분]
		int[] none = new int[3];
		for (Rec r : records) {
			TaskInfo t = r.taskId() == null ? null : tasks.get(r.taskId());
			int[] s = t == null || t.projectId() == null ? none : stats.computeIfAbsent(t.projectId(), k -> new int[3]);
			s[1]++;
			s[2] += r.durationMin() == null ? 0 : r.durationMin();
		}
		for (DoneTask t : done) {
			(t.projectId() == null ? none : stats.computeIfAbsent(t.projectId(), k -> new int[3]))[0]++;
		}
		Map<UUID, String> names = sources.projectNames(c.ownerId(), stats.keySet());
		List<ProjectStat> result = new ArrayList<>();
		stats.forEach((id, s) -> result.add(new ProjectStat(id, names.get(id), s[0], s[1], c.timeTracking() ? s[2] : null)));
		result.sort(Comparator.comparing(ProjectStat::name, Comparator.nullsLast(Comparator.naturalOrder()))
			.thenComparing(ProjectStat::projectId));
		if (none[0] + none[1] > 0) {
			result.add(new ProjectStat(null, null, none[0], none[1], c.timeTracking() ? none[2] : null));
		}
		return result;
	}

	private static Achievement withDates(Achievement a, List<LocalDate> dates) {
		return new Achievement(a.id(), a.text(), a.result(), a.outcome(), a.progress(), a.taskId(), a.projectName(), dates,
				a.recordIds(), a.durationMin(), a.source());
	}

	/** 계획 후보 칩 (LOG-03): 진행 중, 계획 기간 끝까지 마감, 마감 지남. 보관·보류·완료 제외, 마감순(없으면 뒤) → 제목, 최대 20개. */
	List<Candidate> candidates(Context c, Period planPeriod) {
		List<Candidate> result = new ArrayList<>();
		for (TaskInfo t : sources.openTasks(c.ownerId())) {
			String reason = null;
			if (t.dueDate() != null && t.dueDate().isBefore(c.today())) {
				reason = "OVERDUE";
			}
			else if (t.dueDate() != null && !t.dueDate().isAfter(planPeriod.end())) {
				reason = "DUE";
			}
			else if ("IN_PROGRESS".equals(t.status())) {
				reason = "IN_PROGRESS";
			}
			if (reason != null) {
				result.add(new Candidate(t.id(), t.title(), t.status(), t.dueDate(), t.progress(), reason));
			}
		}
		result.sort(Comparator.comparing(Candidate::dueDate, Comparator.nullsLast(Comparator.naturalOrder()))
			.thenComparing(Candidate::title).thenComparing(Candidate::taskId));
		return result.size() > MAX_CANDIDATES ? List.copyOf(result.subList(0, MAX_CANDIDATES)) : result;
	}

	/**
	 * 계획 기간: 일간은 다음 근무일 하루, 다음 근무일이 다음 주면 그 주 (LOG-14). 주간은 다음 주, 월간은 다음 달.
	 */
	static Period planPeriod(WorkCalendar calendar, LogType type, LocalDate start) {
		return switch (type) {
			case DAILY -> {
				LocalDate next = calendar.nextWorkday(start);
				LocalDate nextWeek = calendar.weekStartOf(next);
				yield nextWeek.equals(calendar.weekStartOf(start)) ? new Period(next, next)
						: new Period(nextWeek, nextWeek.plusDays(6));
			}
			case WEEKLY -> new Period(start.plusDays(7), start.plusDays(13));
			case MONTHLY -> {
				LocalDate next = start.plusMonths(1);
				yield new Period(next, LogType.MONTHLY.end(next));
			}
		};
	}

	static String planTitle(LogType type, Period planPeriod) {
		return switch (type) {
			case DAILY -> planPeriod.start().equals(planPeriod.end()) ? "다음 근무일 계획" : "다음 주 계획";
			case WEEKLY -> "다음 주 계획";
			case MONTHLY -> "다음 달 계획";
		};
	}

	/** 하루의 자동 실적: 확정 기록 한 줄씩, 그날 기록 없이 완료한 업무는 업무 제목으로 한 줄. */
	private List<Achievement> autoAchievements(Context c, List<Rec> records, List<DoneTask> done) {
		Set<UUID> taskIds = new HashSet<>();
		records.stream().map(Rec::taskId).filter(Objects::nonNull).forEach(taskIds::add);
		done.forEach(t -> taskIds.add(t.id()));
		Map<UUID, String> projectOfTask = projectNamesOfTasks(c, taskIds);

		List<Achievement> result = new ArrayList<>();
		Set<UUID> recorded = new HashSet<>();
		for (Rec r : records) {
			if (r.taskId() != null) {
				recorded.add(r.taskId());
			}
			result.add(new Achievement(r.id(), r.content(), r.result(), r.outcome(), r.progress(), r.taskId(),
					r.taskId() == null ? null : projectOfTask.get(r.taskId()), List.of(r.workDate()), List.of(r.id()),
					c.timeTracking() ? r.durationMin() : null, "RECORD"));
		}
		for (DoneTask t : done) {
			if (!recorded.contains(t.id())) {
				result.add(new Achievement(t.id(), t.title(), null, "DONE", null, t.id(), projectOfTask.get(t.id()),
						List.of(t.date()), List.of(), null, "TASK"));
			}
		}
		return result;
	}

	/** 고친 실적의 서버 칸을 지금 값으로: 프로젝트 이름, recordIds의 날짜·소요시간. */
	private List<Achievement> enrich(Context c, List<Achievement> rows) {
		Set<UUID> taskIds = new HashSet<>();
		Set<UUID> recordIds = new HashSet<>();
		for (Achievement a : rows) {
			if (a.taskId() != null) {
				taskIds.add(a.taskId());
			}
			recordIds.addAll(a.recordIds());
		}
		Map<UUID, String> projectOfTask = projectNamesOfTasks(c, taskIds);
		Map<UUID, Rec> recs = sources.recordsById(c.ownerId(), recordIds);
		List<Achievement> result = new ArrayList<>();
		for (Achievement a : rows) {
			List<Rec> linked = a.recordIds().stream().map(recs::get).filter(Objects::nonNull).toList();
			List<LocalDate> dates = linked.isEmpty() ? a.dates()
					: linked.stream().map(Rec::workDate).distinct().sorted().toList();
			Integer minutes = null;
			if (c.timeTracking()) {
				minutes = linked.stream().map(Rec::durationMin).filter(Objects::nonNull).reduce(Integer::sum).orElse(null);
			}
			result.add(new Achievement(a.id(), a.text(), a.result(), a.outcome(), a.progress(), a.taskId(),
					a.taskId() == null ? null : projectOfTask.get(a.taskId()), dates, a.recordIds(), minutes, a.source()));
		}
		return result;
	}

	/** 계획의 서버 칸: 마감일, 계획 기간 안 가장 이른 시간 일정 회차 시작. */
	private List<Plan> plans(Context c, Period period, List<Plan> plans) {
		Set<UUID> taskIds = new HashSet<>();
		plans.stream().map(Plan::taskId).filter(Objects::nonNull).forEach(taskIds::add);
		if (taskIds.isEmpty()) {
			return plans.stream().map(p -> new Plan(p.id(), p.text(), null, null, null)).toList();
		}
		Map<UUID, TaskInfo> tasks = sources.tasks(c.ownerId(), taskIds);
		Map<UUID, Instant> earliest = new HashMap<>();
		Instant from = period.start().atStartOfDay(c.zone()).toInstant();
		Instant to = period.end().plusDays(1).atStartOfDay(c.zone()).toInstant();
		for (Ended e : occurrences.timed(c.ownerId(), from, to)) {
			if (e.taskId() != null && taskIds.contains(e.taskId()) && !e.startAt().isBefore(from)) {
				earliest.merge(e.taskId(), e.startAt(), (a, b) -> a.isBefore(b) ? a : b);
			}
		}
		return plans.stream().map(p -> {
			TaskInfo t = p.taskId() == null ? null : tasks.get(p.taskId());
			return new Plan(p.id(), p.text(), p.taskId(), t == null ? null : t.dueDate(),
					p.taskId() == null ? null : earliest.get(p.taskId()));
		}).toList();
	}

	private Metrics metrics(Context c, LocalDate start, LocalDate end, List<Rec> records, List<DoneTask> done) {
		int doneCount = 0;
		int review = 0;
		int inProgress = 0;
		Integer total = null;
		for (Rec r : records) {
			if ("DONE".equals(r.outcome())) {
				doneCount++;
			}
			else if ("REVIEW_REQUESTED".equals(r.outcome())) {
				review++;
			}
			else if ("IN_PROGRESS".equals(r.outcome())) {
				inProgress++;
			}
			if (c.timeTracking()) {
				total = (total == null ? 0 : total) + (r.durationMin() == null ? 0 : r.durationMin());
			}
		}
		if (c.timeTracking() && total == null) {
			total = 0;
		}
		return new Metrics(records.size(), done.size(), doneCount, review, inProgress,
				sources.pendingCount(c.ownerId(), start, end), total);
	}

	private TimeSummaryView time(Context c, LocalDate start, LocalDate end) {
		return c.timeTracking() ? TimeSummaryView.of(times.summary(c.ownerId(), start, end)) : null;
	}

	private Map<UUID, String> projectNamesOfTasks(Context c, Set<UUID> taskIds) {
		Map<UUID, TaskInfo> tasks = sources.tasks(c.ownerId(), taskIds);
		Map<UUID, String> names = sources.projectNames(c.ownerId(),
				tasks.values().stream().map(TaskInfo::projectId).filter(Objects::nonNull).distinct().toList());
		Map<UUID, String> result = new HashMap<>();
		tasks.forEach((id, t) -> {
			if (t.projectId() != null) {
				result.put(id, names.get(t.projectId()));
			}
		});
		return result;
	}

	static Author author(Profile p) {
		return new Author(blankToNull(p.name()), blankToNull(p.organization()), blankToNull(p.position()));
	}

	private static String blankToNull(String s) {
		return s == null || s.isBlank() ? null : s.strip();
	}
}

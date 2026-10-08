package com.erp.worklog.journal;

import com.erp.worklog.journal.LogViews.Achievement;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Day;
import com.erp.worklog.journal.LogViews.Metrics;
import com.erp.worklog.journal.LogViews.Plan;
import com.erp.worklog.journal.LogViews.ProjectStat;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.workrecord.TimeViews.TaskMinutes;
import com.erp.worklog.workrecord.TimeViews.TimeSummaryView;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 내보낼 일지를 서식 명세(docs/업무일지_서식명세.md)의 구성 순서·표기로 옮긴 것. PDF·Word·Excel이 같은 값을 그린다.
 * 이 클래스는 무엇을 쓸지(글자·칸 폭)만 정하고, 선·글꼴은 각 형식이 그린다.
 */
record LogDocument(LogType type, String title, boolean draft, String footerLeft, String author, InfoRow[] info,
		List<Section> sections) {

	/** 정보표 한 행: 이름 칸, 값, 이름 칸, 값 (2.2). */
	record InfoRow(String label1, String value1, String label2, String value2) {
	}

	/** 표. widths는 mm. center는 칸마다 가운데 맞춤인지. total이면 마지막 행이 합계(굵게). */
	record Table(List<String> headers, float[] widths, boolean[] center, List<List<String>> rows, boolean total) {
	}

	enum Kind {
		/** 포함된 날(주간 표, 월간은 line 한 줄) */
		DAYS,
		/** 구분 제목 + (line) + 표 또는 "없음" + (note) */
		TABLE,
		/** 이슈 상자 */
		BOX
	}

	/** 구분 하나. heading이 null이면 제목 없음(포함된 날). boldCells는 포함된 날의 상태 칸마다 굵게(원본 기록). */
	record Section(Kind kind, String heading, String line, Table table, String note, String box, List<Boolean> boldCells) {
	}

	static final String NONE = "없음";
	private static final String[] WEEKDAY = { "월", "화", "수", "목", "금", "토", "일" };
	private static final DateTimeFormatter FOOTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

	/**
	 * today: 주간 표에서 오늘 뒤 날은 빈칸. projectNames: 프로젝트 id → 이름 (소요시간 표용, 업무 제목은 일지 값).
	 * taskTitles: 업무 id → 지금 업무 제목 (진행 현황 괄호용, 없으면 실적 줄 문구).
	 */
	static LogDocument of(WorkLogView log, ZoneId zone, LocalDate today, Map<UUID, String> projectNames,
			Map<UUID, String> taskTitles) {
		Content c = log.content();
		LogType type = LogType.valueOf(log.type());
		String title = switch (type) {
			case DAILY -> "업무일지";
			case WEEKLY -> "주간 업무일지";
			case MONTHLY -> "월간 업무일지";
		};
		boolean draft = !"CONFIRMED".equals(log.status());
		String footer = draft ? "초안 — 확정 전 일지" : "확정 " + FOOTER.format(log.confirmedAt().atZone(zone));
		String name = blank(c.author().name());
		InfoRow[] info = {
				new InfoRow(type == LogType.DAILY ? "일자" : "기간", period(type, log.periodStart(), log.periodEnd()), "작성자", name),
				new InfoRow("소속", blank(c.author().organization()), "직책", blank(c.author().position())) };

		List<Section> sections = new ArrayList<>();
		if (type == LogType.WEEKLY) {
			sections.add(weekDays(c.days(), today));
		}
		else if (type == LogType.MONTHLY) {
			sections.add(monthDays(c.days()));
		}
		sections.add(achievements(type, c));
		sections.add(progress(type, c, taskTitles));
		sections.add(plans(c.planTitle(), c.plans(), zone));
		sections.add(new Section(Kind.BOX, "이슈 및 특이사항", null, null, null, c.issues() == null ? "" : c.issues(), null));
		if (c.time() != null) {
			sections.add(time(c.time(), projectNames));
		}
		return new LogDocument(type, title, draft, footer, name, info, sections);
	}

	private static Section weekDays(List<Day> days, LocalDate today) {
		List<String> head = new ArrayList<>();
		List<String> status = new ArrayList<>();
		List<Boolean> bold = new ArrayList<>();
		boolean anyRecords = false;
		for (Day d : days) {
			head.add(d.date().getMonthValue() + "/" + d.date().getDayOfMonth() + " (" + weekday(d.date()) + ")");
			String s = switch (d.source()) {
				case "CONFIRMED_LOG" -> "확정";
				case "RECORDS" -> "원본 기록";
				default -> !d.workday() ? "휴일" : d.date().isAfter(today) ? "" : "기록 없음";
			};
			anyRecords |= "RECORDS".equals(d.source());
			status.add(s);
			bold.add("RECORDS".equals(d.source()));
		}
		float[] widths = new float[days.size()];
		boolean[] center = new boolean[days.size()];
		java.util.Arrays.fill(widths, 174f / Math.max(1, days.size()));
		java.util.Arrays.fill(center, true);
		Table t = new Table(head, widths, center, List.of(status), false);
		return new Section(Kind.DAYS, null, null, t, anyRecords ? "원본 기록 = 확정 전이라 그날 기록에서 가져온 날" : null, null, bold);
	}

	private static Section monthDays(List<Day> days) {
		int confirmed = 0;
		int records = 0;
		int off = 0;
		for (Day d : days) {
			switch (d.source()) {
				case "CONFIRMED_LOG" -> confirmed++;
				case "RECORDS" -> records++;
				default -> off += d.workday() ? 0 : 1;
			}
		}
		return new Section(Kind.DAYS, null, "확정 일간 " + confirmed + "일 · 원본 기록 " + records + "일 · 휴일 " + off + "일", null,
				null, null, null);
	}

	private static Section achievements(LogType type, Content c) {
		String heading = switch (type) {
			case DAILY -> "금일 실적";
			case WEEKLY -> "이번 주 실적";
			case MONTHLY -> "이번 달 실적";
		};
		boolean project = c.achievements().stream().anyMatch(a -> a.projectName() != null);
		List<String> headers = new ArrayList<>(List.of("No"));
		List<Float> widths = new ArrayList<>(List.of(10f));
		List<Boolean> center = new ArrayList<>(List.of(true));
		float[] spec = switch (type) {
			case DAILY -> new float[] { 24, 64, 56, 20, 0 };
			case WEEKLY -> new float[] { 22, 50, 52, 18, 22 };
			case MONTHLY -> new float[] { 22, 60, 52, 18, 12 };
		};
		if (project) {
			headers.add("프로젝트");
			widths.add(spec[0]);
			center.add(false);
		}
		headers.add(type == LogType.DAILY ? "업무 내용" : "업무");
		widths.add(spec[1] + (project ? 0 : spec[0]));
		center.add(false);
		headers.add("결과");
		widths.add(spec[2]);
		center.add(false);
		headers.add("진행률");
		widths.add(spec[3]);
		center.add(true);
		if (type != LogType.DAILY) {
			headers.add(type == LogType.WEEKLY ? "한 날" : "기록 일수");
			widths.add(spec[4]);
			center.add(true);
		}
		List<List<String>> rows = new ArrayList<>();
		int no = 1;
		for (Achievement a : c.achievements()) {
			List<String> row = new ArrayList<>(List.of(String.valueOf(no++)));
			if (project) {
				row.add(blank(a.projectName()));
			}
			row.add(a.text());
			row.add(blank(a.result()));
			row.add(progress(a.outcome(), a.progress()));
			if (type == LogType.WEEKLY) {
				row.add(String.join("·", a.dates().stream().map(LogDocument::weekday).toList()));
			}
			else if (type == LogType.MONTHLY) {
				row.add(a.dates().isEmpty() ? "" : a.dates().size() + "일");
			}
			rows.add(row);
		}
		int pending = c.metrics().pendingCount();
		String note = pending > 0 ? "확인 대기 " + pending + "건은 실적에 넣지 않았어요" : null;
		return new Section(Kind.TABLE, heading, null, rows.isEmpty() ? null : table(headers, widths, center, rows, false), note,
				null, null);
	}

	private static Section progress(LogType type, Content c, Map<UUID, String> taskTitles) {
		Metrics m = c.metrics();
		List<String> parts = new ArrayList<>();
		if (type == LogType.MONTHLY) {
			if (m.completedTaskCount() > 0) {
				parts.add("완료 업무 " + m.completedTaskCount() + "건");
			}
			if (m.recordCount() > 0) {
				parts.add("기록 " + m.recordCount() + "건");
			}
			String line = parts.isEmpty() ? NONE : String.join(" · ", parts);
			return new Section(Kind.TABLE, "진행 현황", line, c.projects().isEmpty() ? null : projectTable(c), null, null, null);
		}
		if (m.done() > 0) {
			parts.add("완료 " + m.done() + "건");
		}
		if (m.inProgress() > 0) {
			parts.add("진행 중 " + m.inProgress() + "건");
		}
		if (m.reviewRequested() > 0) {
			parts.add("검토 요청 " + m.reviewRequested() + "건");
		}
		String line = parts.isEmpty() ? NONE : String.join(" · ", parts);
		// 괄호는 업무명과 진행률 (서식 명세 2.5): 같은 업무의 줄이 여럿이면 마지막 줄의 진행률로 한 번만
		Map<Object, String> byTask = new LinkedHashMap<>();
		for (Achievement a : c.achievements()) {
			if ("IN_PROGRESS".equals(a.outcome())) {
				String name = a.taskId() == null ? a.text() : taskTitles.getOrDefault(a.taskId(), a.text());
				byTask.remove(a.taskId() == null ? a : a.taskId());
				byTask.put(a.taskId() == null ? a : a.taskId(), name + (a.progress() == null ? "" : " " + a.progress() + "%"));
			}
		}
		List<String> going = List.copyOf(byTask.values());
		if (!going.isEmpty() && !parts.isEmpty()) {
			String list = String.join(", ", going.subList(0, Math.min(3, going.size())));
			line += " (" + list + (going.size() > 3 ? " 외 " + (going.size() - 3) + "건" : "") + ")";
		}
		return new Section(Kind.TABLE, "진행 현황", line, null, null, null, null);
	}

	private static Table projectTable(Content c) {
		boolean time = c.time() != null;
		List<String> headers = new ArrayList<>(List.of("프로젝트", "완료 업무", "기록"));
		List<Float> widths = new ArrayList<>(List.of(time ? 60f : 114f, 30f, 30f));
		List<Boolean> center = new ArrayList<>(List.of(false, true, true));
		if (time) {
			headers.addAll(List.of("소요시간", "비중"));
			widths.addAll(List.of(34f, 20f));
			center.addAll(List.of(true, true));
		}
		int done = 0;
		int records = 0;
		int minutes = 0;
		for (ProjectStat p : c.projects()) {
			done += p.completedTaskCount();
			records += p.recordCount();
			minutes += p.minutes() == null ? 0 : p.minutes();
		}
		List<List<String>> rows = new ArrayList<>();
		for (ProjectStat p : c.projects()) {
			List<String> row = new ArrayList<>(List.of(p.name() == null ? "프로젝트 없음" : p.name(),
					count(p.completedTaskCount()), count(p.recordCount())));
			if (time) {
				int min = p.minutes() == null ? 0 : p.minutes();
				row.add(minutes(min));
				row.add(share(min, minutes));
			}
			rows.add(row);
		}
		List<String> total = new ArrayList<>(List.of("합계", count(done), count(records)));
		if (time) {
			total.add(minutes(minutes));
			total.add(minutes > 0 ? "100%" : "");
		}
		rows.add(total);
		return table(headers, widths, center, rows, true);
	}

	private static Section plans(String heading, List<Plan> plans, ZoneId zone) {
		List<List<String>> rows = new ArrayList<>();
		int no = 1;
		for (Plan p : plans) {
			String when = "";
			if (p.scheduledAt() != null) {
				ZonedDateTime at = p.scheduledAt().atZone(zone);
				when = shortDate(at.toLocalDate()) + " " + String.format("%02d:%02d", at.getHour(), at.getMinute());
			}
			else if (p.dueDate() != null) {
				when = "마감 " + shortDate(p.dueDate());
			}
			rows.add(List.of(String.valueOf(no++), p.text(), when));
		}
		Table t = rows.isEmpty() ? null
				: table(List.of("No", "업무", "예정"), List.of(10f, 120f, 44f), List.of(true, false, false), rows, false);
		return new Section(Kind.TABLE, heading, null, t, null, null, null);
	}

	private static Section time(TimeSummaryView time, Map<UUID, String> projectNames) {
		List<List<String>> rows = new ArrayList<>();
		for (TaskMinutes t : time.tasks()) {
			// 프로젝트 없는 업무는 빈칸 (화면과 같음, pm 결정 2026-10-08 — "프로젝트 없음"은 월간 프로젝트 표 2.5만)
			String project = t.projectId() == null ? "" : projectNames.getOrDefault(t.projectId(), "");
			String task = t.taskId() == null ? "업무 없음" : t.title() == null ? "" : t.title();
			rows.add(List.of(project, task, minutes(t.minutes()), share(t.minutes(), time.totalMin())));
		}
		rows.add(List.of("합계", "", minutes(time.totalMin()), time.totalMin() > 0 ? "100%" : ""));
		return new Section(Kind.TABLE, "소요시간", null,
				table(List.of("프로젝트", "업무", "소요시간", "비중"), List.of(50f, 80f, 26f, 18f), List.of(false, false, true, true), rows,
						true),
				null, null, null);
	}

	// ---- 표기 (1.6)

	static String date(LocalDate d) {
		return d.getYear() + "년 " + d.getMonthValue() + "월 " + d.getDayOfMonth() + "일 (" + weekday(d) + ")";
	}

	static String period(LogType type, LocalDate start, LocalDate end) {
		return switch (type) {
			case DAILY -> date(start);
			case WEEKLY -> date(start) + " ~ " + (end.getYear() != start.getYear() ? end.getYear() + "년 " : "")
					+ end.getMonthValue() + "월 " + end.getDayOfMonth() + "일 (" + weekday(end) + ")";
			case MONTHLY -> start.getYear() + "년 " + start.getMonthValue() + "월";
		};
	}

	static String minutes(int min) {
		if (min <= 0) {
			return "—";
		}
		return min < 60 ? min + "분" : (min / 60) + "시간" + (min % 60 == 0 ? "" : " " + (min % 60) + "분");
	}

	static String progress(String outcome, Integer progress) {
		if (outcome == null) {
			return "";
		}
		return switch (outcome) {
			case "DONE" -> "완료";
			case "REVIEW_REQUESTED" -> "검토 요청";
			case "IN_PROGRESS" -> progress == null ? "진행 중" : progress + "%";
			default -> "";
		};
	}

	static String weekday(LocalDate d) {
		return WEEKDAY[d.getDayOfWeek().getValue() - 1];
	}

	private static String shortDate(LocalDate d) {
		return d.getMonthValue() + "/" + d.getDayOfMonth() + " (" + weekday(d) + ")";
	}

	private static String share(int part, int total) {
		return total <= 0 ? "" : Math.round(part * 100f / total) + "%";
	}

	private static String count(int n) {
		return n + "건";
	}

	private static String blank(String s) {
		return s == null ? "" : s;
	}

	private static Table table(List<String> headers, List<Float> widths, List<Boolean> center, List<List<String>> rows,
			boolean total) {
		float[] w = new float[widths.size()];
		boolean[] c = new boolean[center.size()];
		for (int i = 0; i < w.length; i++) {
			w[i] = widths.get(i);
			c[i] = center.get(i);
		}
		return new Table(headers, w, c, rows, total);
	}

}

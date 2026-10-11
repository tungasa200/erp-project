package com.erp.worklog.stats;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.schedule.EndedOccurrences.Ended;
import com.erp.worklog.schedule.PlanOccurrences;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 업무 통계 (P4-02, STAT-01·UX-05, contracts/worklog.yaml stats). 화면이 차트를 그리므로 숫자만 만든다. */
@Service
public class StatsService {

	static final int MAX_RANGE_DAYS = 400;

	public record Day(LocalDate date, int completedTaskCount, int recordCount) {
	}

	public record ProjectRow(UUID projectId, int completedTaskCount, int recordCount) {
	}

	public record Stats(LocalDate from, LocalDate to, int completedTaskCount, int recordCount, int confirmedLogCount,
			List<Day> daily, List<ProjectRow> projects, LocalDate firstRecordDate) {
	}

	public record Week(LocalDate weekStart, int plannedMin, int actualMin, int unplannedMin) {
	}

	public record TaskDiff(UUID taskId, String title, UUID projectId, int plannedMin, int actualMin) {
	}

	public record PlanVsActual(LocalDate from, LocalDate to, List<Week> weeks, List<TaskDiff> topDiffs) {
	}

	private final JdbcClient jdbc;
	private final PlanOccurrences plans;

	StatsService(JdbcClient jdbc, PlanOccurrences plans) {
		this.jdbc = jdbc;
		this.plans = plans;
	}

	@Transactional(readOnly = true)
	public Stats stats(UUID ownerId, String timezone, LocalDate from, LocalDate to) {
		validate(from, to);
		ZoneId zone = ZoneId.of(timezone);
		Map<LocalDate, int[]> days = new LinkedHashMap<>();
		for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
			days.put(d, new int[2]);
		}
		Map<UUID, int[]> projects = new HashMap<>();
		int[] totals = new int[2];

		// 완료 업무: 완료 시각을 사용자 시간대 날짜로. 지금 DONE인 것만(완료 취소는 completed_at이 비므로 빠진다)
		jdbc.sql("""
				SELECT completed_at, project_id FROM task
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'DONE'
				  AND completed_at >= :start AND completed_at < :end""")
			.param("owner", ownerId).param("start", utc(from.atStartOfDay(zone).toInstant()))
			.param("end", utc(to.plusDays(1).atStartOfDay(zone).toInstant()))
			.query((rs, i) -> {
				LocalDate d = rs.getObject("completed_at", OffsetDateTime.class).atZoneSameInstant(zone).toLocalDate();
				days.get(d)[0]++;
				projects.computeIfAbsent(rs.getObject("project_id", UUID.class), k -> new int[2])[0]++;
				totals[0]++;
				return null;
			})
			.list();

		// 기록: 확정·보관하지 않은 기록, workDate 기준. 프로젝트는 연결 업무의 지금 프로젝트
		jdbc.sql("""
				SELECT r.work_date, t.project_id, count(*) AS n
				FROM work_record r LEFT JOIN task t ON t.id = r.task_id
				WHERE r.owner_id = :owner AND r.deleted_at IS NULL AND r.status = 'CONFIRMED'
				  AND r.work_date BETWEEN :from AND :to
				GROUP BY r.work_date, t.project_id""")
			.param("owner", ownerId).param("from", from).param("to", to)
			.query((rs, i) -> {
				int n = rs.getInt("n");
				days.get(rs.getObject("work_date", LocalDate.class))[1] += n;
				projects.computeIfAbsent(rs.getObject("project_id", UUID.class), k -> new int[2])[1] += n;
				totals[1] += n;
				return null;
			})
			.list();

		int confirmedLogs = jdbc.sql("""
				SELECT count(*) FROM work_log
				WHERE owner_id = :owner AND status = 'CONFIRMED' AND period_start BETWEEN :from AND :to""")
			.param("owner", ownerId).param("from", from).param("to", to)
			.query(Integer.class).single();

		LocalDate first = jdbc.sql("""
				SELECT min(work_date) FROM work_record
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'CONFIRMED'""")
			.param("owner", ownerId)
			.query(LocalDate.class).optional().orElse(null);

		List<Day> daily = days.entrySet().stream().map(e -> new Day(e.getKey(), e.getValue()[0], e.getValue()[1])).toList();
		List<ProjectRow> projectRows = projects.entrySet().stream()
			.map(e -> new ProjectRow(e.getKey(), e.getValue()[0], e.getValue()[1]))
			.sorted(Comparator.comparingInt(ProjectRow::completedTaskCount).reversed()
				.thenComparing(Comparator.comparingInt(ProjectRow::recordCount).reversed())
				.thenComparing(ProjectRow::projectId, Comparator.nullsLast(Comparator.naturalOrder())))
			.toList();
		return new Stats(from, to, totals[0], totals[1], confirmedLogs, daily, projectRows, first);
	}

	/**
	 * 예상 대비 실제 (UX-05, 카드 0401). 예상 = 업무에 연결된 시간 일정 회차 길이(종일·업무 없는 일정 제외, 회차 시작의 사용자 시간대 날짜로 주를 정함).
	 * 실제 = 확정·보관하지 않은 기록의 durationMin을 workDate·업무로 묶은 것.
	 */
	@Transactional(readOnly = true)
	public PlanVsActual planVsActual(UUID ownerId, String timezone, String weekStart, LocalDate from, LocalDate to) {
		validate(from, to);
		ZoneId zone = ZoneId.of(timezone);
		DayOfWeek first = weekStart == null ? DayOfWeek.MONDAY : DayOfWeek.valueOf(weekStart);

		// 주 → 업무 → 분
		Map<LocalDate, Map<UUID, Integer>> planned = new HashMap<>();
		Map<LocalDate, Map<UUID, Integer>> actual = new HashMap<>();
		Instant start = from.atStartOfDay(zone).toInstant();
		Instant end = to.plusDays(1).atStartOfDay(zone).toInstant();
		for (Ended e : plans.timed(ownerId, start, end)) {
			if (e.taskId() == null || e.startAt().isBefore(start) || !e.startAt().isBefore(end)) {
				continue; // 업무 없는 일정, 기간 밖에서 시작한 회차
			}
			LocalDate week = weekOf(e.startAt().atZone(zone).toLocalDate(), first);
			int minutes = (int) Duration.between(e.startAt(), e.endAt()).toMinutes();
			planned.computeIfAbsent(week, k -> new HashMap<>()).merge(e.taskId(), minutes, Integer::sum);
		}
		jdbc.sql("""
				SELECT work_date, task_id, sum(duration_min) AS minutes FROM work_record
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'CONFIRMED'
				  AND work_date BETWEEN :from AND :to AND duration_min IS NOT NULL
				GROUP BY work_date, task_id""")
			.param("owner", ownerId).param("from", from).param("to", to)
			.query((rs, i) -> {
				LocalDate week = weekOf(rs.getObject("work_date", LocalDate.class), first);
				// HashMap은 null 키를 받는다: 업무 없는 기록은 null 업무로 묶는다
				actual.computeIfAbsent(week, k -> new HashMap<>())
					.merge(rs.getObject("task_id", UUID.class), rs.getInt("minutes"), Integer::sum);
				return null;
			})
			.list();

		List<Week> weeks = new ArrayList<>();
		Map<UUID, int[]> byTask = new HashMap<>(); // [예상, 실제] — 기간 전체, 예상이 있는 업무만
		for (LocalDate w = weekOf(from, first); !w.isAfter(to); w = w.plusWeeks(1)) {
			Map<UUID, Integer> p = planned.getOrDefault(w, Map.of());
			Map<UUID, Integer> a = actual.getOrDefault(w, Map.of());
			int plannedMin = 0;
			int actualMin = 0;
			int unplannedMin = 0;
			for (var entry : p.entrySet()) {
				plannedMin += entry.getValue();
				byTask.computeIfAbsent(entry.getKey(), k -> new int[2])[0] += entry.getValue();
			}
			for (var entry : a.entrySet()) {
				if (entry.getKey() != null && p.containsKey(entry.getKey())) {
					actualMin += entry.getValue();
				}
				else {
					unplannedMin += entry.getValue();
				}
			}
			weeks.add(new Week(w, plannedMin, actualMin, unplannedMin));
		}
		// 업무의 실제는 기간 전체 합(예상이 없던 주의 기록도 포함)
		for (Map<UUID, Integer> a : actual.values()) {
			a.forEach((task, minutes) -> {
				int[] row = task == null ? null : byTask.get(task);
				if (row != null) {
					row[1] += minutes;
				}
			});
		}
		List<UUID> top = byTask.entrySet().stream()
			.sorted(Comparator.<Map.Entry<UUID, int[]>>comparingInt(e -> -Math.abs(e.getValue()[1] - e.getValue()[0]))
				.thenComparing(Map.Entry::getKey))
			.limit(5)
			.map(Map.Entry::getKey)
			.toList();
		List<TaskDiff> diffs = new ArrayList<>();
		if (!top.isEmpty()) {
			Map<UUID, Object[]> tasks = new HashMap<>();
			jdbc.sql("SELECT id, title, project_id FROM task WHERE owner_id = :owner AND id IN (:ids)")
				.param("owner", ownerId).param("ids", top)
				.query((rs, i) -> tasks.put(rs.getObject("id", UUID.class),
						new Object[] { rs.getString("title"), rs.getObject("project_id", UUID.class) }))
				.list();
			for (UUID id : top) {
				Object[] t = tasks.get(id);
				if (t == null) {
					continue; // 일정이 가리키는 업무가 사라짐(정합성상 없어야 함)
				}
				int[] row = byTask.get(id);
				diffs.add(new TaskDiff(id, (String) t[0], (UUID) t[1], row[0], row[1]));
			}
		}
		return new PlanVsActual(from, to, weeks, diffs);
	}

	private static LocalDate weekOf(LocalDate date, DayOfWeek first) {
		return date.with(TemporalAdjusters.previousOrSame(first));
	}

	private static void validate(LocalDate from, LocalDate to) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (from == null) {
			errors.add(new FieldErrorDetail("from", "REQUIRED", null));
		}
		if (to == null) {
			errors.add(new FieldErrorDetail("to", "REQUIRED", null));
		}
		else if (from != null && to.isBefore(from)) {
			errors.add(new FieldErrorDetail("to", "INVALID_ORDER", null));
		}
		else if (from != null && ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS) {
			errors.add(new FieldErrorDetail("to", "OUT_OF_RANGE", null));
		}
		if (!errors.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.", errors, Map.of());
		}
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}
}

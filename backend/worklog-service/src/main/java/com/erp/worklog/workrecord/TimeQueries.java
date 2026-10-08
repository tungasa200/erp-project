package com.erp.worklog.workrecord;

import com.erp.common.error.FieldErrorDetail;
import com.erp.worklog.schedule.EndedOccurrences.Ended;
import com.erp.worklog.schedule.PlanOccurrences;
import com.erp.worklog.setting.SettingsService;
import com.erp.worklog.task.FrequentTaskQueries;
import com.erp.worklog.task.FrequentTaskQueries.FrequentTask;
import com.erp.worklog.workrecord.TimerService.Recorded;
import com.erp.worklog.workrecord.WorkRecord.Status;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/** 소요시간 집계와 빈 시간 (P2-07, TIME-07·11). */
@Service
public class TimeQueries {

	/** 이보다 짧은 빈 구간은 주지 않는다. */
	static final Duration MIN_GAP = Duration.ofMinutes(15);

	public record Row(UUID id, UUID projectId, int minutes) {
	}

	public record Summary(LocalDate from, LocalDate to, int totalMin, int recordCount, List<Row> projects, List<Row> tasks) {
	}

	record Previous(String content, UUID taskId) {
	}

	record Plan(Ended block, UUID pendingRecordId) {
	}

	record Gap(Instant startAt, Instant endAt, int minutes, Previous previous, Plan plan, FrequentTask frequent) {
	}

	private record Timed(Instant start, Instant end, String content, UUID taskId) {
	}

	private final WorkRecordService service;
	private final TimerService timer;
	private final PlanOccurrences plans;
	private final SettingsService settings;
	private final FrequentTaskQueries frequent;
	private final JdbcClient jdbc;
	private final Clock clock;

	TimeQueries(WorkRecordService service, TimerService timer, PlanOccurrences plans, SettingsService settings,
			FrequentTaskQueries frequent, JdbcClient jdbc, Clock clock) {
		this.service = service;
		this.timer = timer;
		this.plans = plans;
		this.settings = settings;
		this.frequent = frequent;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	/** 확정·보관하지 않은 기록 중 소요시간이 있는 것만 더한다(실행 중 타이머·시간 없는 기록 제외). 겹친 기록은 두 번 센다. */
	@Transactional(readOnly = true)
	public Summary summary(UUID ownerId, LocalDate from, LocalDate to) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (from == null) {
			errors.add(WorkRecordService.error("from", "REQUIRED"));
		}
		if (to == null) {
			errors.add(WorkRecordService.error("to", "REQUIRED"));
		}
		else if (from != null && to.isBefore(from)) {
			errors.add(WorkRecordService.error("to", "INVALID_ORDER"));
		}
		else if (from != null && ChronoUnit.DAYS.between(from, to) > WorkRecordService.MAX_RANGE_DAYS) {
			errors.add(WorkRecordService.error("to", "OUT_OF_RANGE"));
		}
		WorkRecordService.throwIfAny(errors);

		int[] count = { 0 };
		List<Row> tasks = new ArrayList<>(jdbc.sql("""
				SELECT r.task_id, t.project_id, sum(r.duration_min) AS minutes, count(*) AS n
				FROM work_record r LEFT JOIN task t ON t.id = r.task_id
				WHERE r.owner_id = :owner AND r.deleted_at IS NULL AND r.status = 'CONFIRMED'
				  AND r.work_date BETWEEN :from AND :to AND r.duration_min IS NOT NULL
				GROUP BY r.task_id, t.project_id""")
			.param("owner", ownerId).param("from", from).param("to", to)
			.query((rs, i) -> {
				count[0] += rs.getInt("n");
				return new Row(rs.getObject("task_id", UUID.class), rs.getObject("project_id", UUID.class),
						rs.getInt("minutes"));
			})
			.list());
		Map<UUID, Integer> byProject = new LinkedHashMap<>();
		for (Row t : tasks) {
			byProject.merge(t.projectId(), t.minutes(), Integer::sum);
		}
		List<Row> projects = new ArrayList<>(byProject.entrySet().stream()
			.map(e -> new Row(e.getKey(), null, e.getValue())).toList());
		tasks.sort(ORDER);
		projects.sort(ORDER);
		int total = tasks.stream().mapToInt(Row::minutes).sum();
		return new Summary(from, to, total, count[0], projects, tasks);
	}

	/** minutes 내림차순 → id (null은 뒤). */
	private static final Comparator<Row> ORDER = Comparator.comparingInt(Row::minutes).reversed()
		.thenComparing(Row::id, Comparator.nullsLast(Comparator.naturalOrder()));

	/**
	 * date의 업무 시간대 중 기록이 덮지 않은 15분 이상 구간과 후보. 계획 후보가 확인 대기를 가리키도록
	 * 그날 끝난 회차의 확인 대기를 먼저 만든다(D-31) — 화면이 새 기록을 만들어 같은 계획을 두 번 세지 않게.
	 */
	@Transactional
	List<Gap> gaps(UUID ownerId, Supplier<String> timezone, LocalDate date) {
		if (date == null) {
			WorkRecordService.throwIfAny(List.of(WorkRecordService.error("date", "REQUIRED")));
		}
		ZoneId zone = ZoneId.of(timezone.get());
		Instant now = clock.instant();
		SettingsService.Settings s = settings.get(ownerId);
		Instant dayStart = date.atStartOfDay(zone).toInstant();
		Instant windowStart = date.atTime(s.workHoursStart()).atZone(zone).toInstant();
		Instant windowEnd = date.atTime(s.workHoursEnd()).atZone(zone).toInstant();
		if (now.isBefore(windowEnd)) {
			windowEnd = now; // 오늘이면 지금까지, 미래면 빈 구간 없음
		}
		if (!windowStart.isBefore(windowEnd)) {
			return List.of();
		}
		service.generate(ownerId, date, date);

		Instant until = windowEnd;
		// 덮은 구간: 확정 기록의 [startAt, endAt), 실행 중 타이머는 [startAt, 지금). workDate와 관계없이 시각으로 본다
		List<Timed> timed = jdbc.sql("""
				SELECT start_at, coalesce(end_at, :now) AS end_at, content, task_id
				FROM work_record
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'CONFIRMED' AND start_at IS NOT NULL
				  AND start_at < :until AND coalesce(end_at, :now) > :dayStart
				ORDER BY start_at""")
			.param("owner", ownerId).param("now", utc(now)).param("until", utc(until)).param("dayStart", utc(dayStart))
			.query((rs, i) -> new Timed(rs.getObject("start_at", OffsetDateTime.class).toInstant(),
					rs.getObject("end_at", OffsetDateTime.class).toInstant(), rs.getString("content"),
					rs.getObject("task_id", UUID.class)))
			.list();

		List<Instant[]> holes = new ArrayList<>();
		Instant cursor = windowStart;
		for (Timed t : timed) {
			if (t.start().isAfter(cursor)) {
				holes.add(new Instant[] { cursor, min(t.start(), until) });
			}
			if (t.end().isAfter(cursor)) {
				cursor = t.end();
			}
			if (!cursor.isBefore(until)) {
				break;
			}
		}
		if (cursor.isBefore(until)) {
			holes.add(new Instant[] { cursor, until });
		}
		holes.removeIf(h -> Duration.between(h[0], h[1]).compareTo(MIN_GAP) < 0);
		if (holes.isEmpty()) {
			return List.of();
		}

		List<Ended> blocks = plans.timed(ownerId, windowStart, until);
		Map<String, Recorded> recorded = blocks.isEmpty() ? Map.of() : timer.recordedKeys(ownerId, blocks);
		String tz = zone.getId();
		List<Gap> result = new ArrayList<>();
		for (Instant[] h : holes) {
			Previous previous = timed.stream()
				.filter(t -> !t.end().isAfter(h[0]) && t.end().isAfter(dayStart))
				.max(Comparator.comparing(Timed::end))
				.map(t -> new Previous(t.content(), t.taskId()))
				.orElse(null);
			result.add(new Gap(h[0], h[1], (int) Duration.between(h[0], h[1]).toMinutes(), previous,
					plan(blocks, recorded, h[0], h[1]), frequent.list(ownerId, tz, h[0]).stream().findFirst().orElse(null)));
		}
		return result;
	}

	/** 구간과 가장 많이 겹치는 회차. 이미 처리한(확정·하지 않음·보관) 회차는 빼고, 확인 대기면 그 기록을 가리킨다. */
	private static Plan plan(List<Ended> blocks, Map<String, Recorded> recorded, Instant from, Instant to) {
		Ended best = null;
		long bestOverlap = 0;
		for (Ended e : blocks) {
			Recorded r = recorded.get(WorkRecordService.key(e.scheduleId(), e.key()));
			if (r != null && (r.status() != Status.PENDING || r.deleted())) {
				continue;
			}
			long overlap = Duration.between(max(e.startAt(), from), min(e.endAt(), to)).toSeconds();
			if (overlap > bestOverlap || (overlap == bestOverlap && overlap > 0 && best != null
					&& e.startAt().isBefore(best.startAt()))) {
				best = e;
				bestOverlap = overlap;
			}
		}
		if (best == null) {
			return null;
		}
		Recorded r = recorded.get(WorkRecordService.key(best.scheduleId(), best.key()));
		return new Plan(best, r == null ? null : r.id());
	}

	private static Instant min(Instant a, Instant b) {
		return a.isBefore(b) ? a : b;
	}

	private static Instant max(Instant a, Instant b) {
		return a.isAfter(b) ? a : b;
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}
}

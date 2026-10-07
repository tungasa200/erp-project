package com.erp.worklog.workrecord;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.worklog.error.Errors;
import com.erp.worklog.schedule.EndedOccurrences.Ended;
import com.erp.worklog.schedule.PlanOccurrences;
import com.erp.worklog.setting.SettingsService;
import com.erp.worklog.workrecord.WorkRecord.Status;
import com.erp.worklog.workrecord.WorkRecordService.RecordInfo;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * 타이머 (P2-06, TIME-03·10). 실행 중 타이머는 endAt 없는 기록이고 사용자당 하나다(V7 부분 UNIQUE).
 * 시작·정지는 사용자별 권고 잠금으로 한 줄로 세운다. 부분 UNIQUE는 잠금 밖의 경로(복원)까지 막는 마지막 방어다.
 */
@Service
class TimerService {

	/** 이보다 짧으면 실수로 누른 타이머로 보고 버린다 (소요시간 최소 1분, P2-01). */
	static final Duration MIN = Duration.ofMinutes(1);
	/** 소요시간 최대 1440분 (P2-01). 넘으면 여기서 자른다. */
	static final Duration MAX = Duration.ofHours(24);

	record Stopped(RecordInfo record, boolean discarded, boolean capped) {
	}

	record Started(RecordInfo running, Stopped stopped) {
	}

	record StopResult(Stopped stopped, Ended next) {
	}

	record Start(UUID taskId, String content, UUID scheduleId, Instant occurrenceStart) {
	}

	private final WorkRecordRepository records;
	private final WorkRecordService service;
	private final PlanOccurrences plans;
	private final SettingsService settings;
	private final JdbcClient jdbc;
	private final Clock clock;

	TimerService(WorkRecordRepository records, WorkRecordService service, PlanOccurrences plans,
			SettingsService settings, JdbcClient jdbc, Clock clock) {
		this.records = records;
		this.service = service;
		this.plans = plans;
		this.settings = settings;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	Optional<RecordInfo> running(UUID ownerId) {
		return records.findRunning(ownerId).map(r -> service.infos(List.of(r)).getFirst());
	}

	@Transactional
	Started start(UUID ownerId, Supplier<String> timezone, Start s) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		String content = s.content() == null || s.content().isBlank() ? null : s.content().strip();
		boolean plan = s.scheduleId() != null || s.occurrenceStart() != null;
		if (s.taskId() == null && content == null && !plan) {
			errors.add(WorkRecordService.error("content", "REQUIRED"));
		}
		if (plan && (s.scheduleId() == null || s.occurrenceStart() == null)) {
			errors.add(WorkRecordService.error(s.scheduleId() == null ? "scheduleId" : "occurrenceStart", "INVALID_FORMAT"));
		}
		String taskTitle = null;
		if (s.taskId() != null) {
			taskTitle = jdbc.sql("SELECT title FROM task WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
				.params(s.taskId(), ownerId).query(String.class).optional().orElse(null);
			if (taskTitle == null) {
				errors.add(WorkRecordService.error("taskId", "NOT_FOUND"));
			}
		}
		WorkRecordService.throwIfAny(errors);
		if (!settings.get(ownerId).timeTrackingEnabled()) {
			throw new ApiException(HttpStatus.CONFLICT, "TIME_TRACKING_DISABLED", "시간 기록 옵션이 꺼져 있어요. 설정에서 켜 주세요.");
		}

		lock(ownerId);
		Instant now = clock.instant();
		// 앞 타이머를 먼저 멈춰 반영한다. 새 기록을 먼저 바꾸면 한 flush 안에서 순서가 섞여 부분 UNIQUE에 걸린다
		Stopped stopped = stopRunning(ownerId, now);
		WorkRecord r;
		if (plan) {
			Ended e = plans.find(ownerId, s.scheduleId(), s.occurrenceStart()).orElseThrow(Errors::notFound);
			// 회차의 확인 대기가 있으면 그 기록을 가져간다. 그래서 회차가 끝나도 확인 대기가 따로 생기지 않는다
			r = records.findByScheduleIdAndOccurrenceStart(e.scheduleId(), e.key()).orElse(null);
			if (r != null && (r.status() != Status.PENDING || r.deletedAt() != null)) {
				throw new ApiException(HttpStatus.CONFLICT, "ALREADY_RECORDED", "이 계획은 이미 기록했어요.");
			}
			if (r == null) {
				r = new WorkRecord(ownerId, now);
				r.plan(e.scheduleId(), e.key());
				r.taskId(e.taskId());
				r.content(e.title());
			}
			r.status(Status.CONFIRMED);
		}
		else {
			r = new WorkRecord(ownerId, now);
		}
		if (s.taskId() != null) {
			r.taskId(s.taskId());
			r.content(taskTitle);
		}
		if (content != null) {
			r.content(content);
		}
		r.time(now, null, null);
		r.workDate(WorkRecordService.dateOf(now, timezone));
		r.touch(now);
		try {
			return new Started(service.infos(List.of(records.saveAndFlush(r))).getFirst(), stopped);
		} catch (DataIntegrityViolationException e) {
			String message = String.valueOf(e.getMostSpecificCause().getMessage());
			if (message.contains("work_record_occurrence")) {
				// 확인과 넣기 사이에 그 회차의 확인 대기가 생김. 다시 누르면 그 기록을 가져간다
				throw new ApiException(HttpStatus.CONFLICT, "ALREADY_RECORDED", "이 계획의 기록이 방금 생겼어요. 다시 시도해 주세요.");
			}
			throw WorkRecordService.timerRunning();
		}
	}

	/** 실행 중인 타이머를 멈추고 이어달리기 제안을 붙인다. 실행 중인 타이머가 없으면 stopped=null (멱등). */
	@Transactional
	StopResult stop(UUID ownerId, Supplier<String> timezone) {
		lock(ownerId);
		Instant now = clock.instant();
		Stopped stopped = stopRunning(ownerId, now);
		return new StopResult(stopped, next(ownerId, ZoneId.of(timezone.get()), now));
	}

	/**
	 * 1분 미만은 버린다: 회차를 가져간 기록은 시간 칸을 비워 확인 대기로 되돌리고, 아니면 지운다(하드 삭제).
	 * 24시간을 넘으면 startAt+24시간으로 멈춘다. 다음 넣기가 부분 UNIQUE에 걸리지 않게 여기서 반영한다.
	 */
	private Stopped stopRunning(UUID ownerId, Instant now) {
		WorkRecord r = records.findRunning(ownerId).orElse(null);
		if (r == null) {
			return null;
		}
		Duration took = Duration.between(r.startAt(), now);
		if (took.compareTo(MIN) < 0) {
			if (r.fromPlan()) {
				r.time(null, null, null);
				r.status(Status.PENDING);
				// 확인 대기의 날짜는 회차 날짜다(시작할 때 오늘로 바꿨다). 일정을 지웠으면 그대로 둔다
				if (r.scheduleId() != null) {
					plans.find(ownerId, r.scheduleId(), r.occurrenceStart()).ifPresent(e -> r.workDate(e.workDate()));
				}
				r.touch(now);
				return new Stopped(service.infos(List.of(records.saveAndFlush(r))).getFirst(), true, false);
			}
			RecordInfo last = service.infos(List.of(r)).getFirst();
			records.delete(r);
			records.flush();
			return new Stopped(last, true, false);
		}
		boolean capped = took.compareTo(MAX) > 0;
		Instant end = capped ? r.startAt().plus(MAX) : now;
		r.time(r.startAt(), end, (int) Duration.between(r.startAt(), end).toMinutes());
		r.touch(now);
		return new Stopped(service.infos(List.of(records.saveAndFlush(r))).getFirst(), false, capped);
	}

	/**
	 * 이어달리기 제안 (TIME-10): 사용자 시간대 오늘과 겹치는 시간 일정 회차 중 끝이 지금 이후이고 기록이 없는 것.
	 * 시작이 이른 순이라 지금 진행 중인 회차(시작 ≤ 지금)가 앞에 온다.
	 */
	private Ended next(UUID ownerId, ZoneId zone, Instant now) {
		LocalDate today = LocalDate.ofInstant(now, zone);
		List<Ended> candidates = plans.timed(ownerId, today.atStartOfDay(zone).toInstant(),
				today.plusDays(1).atStartOfDay(zone).toInstant())
			.stream().filter(e -> e.endAt().isAfter(now)).toList();
		if (candidates.isEmpty()) {
			return null;
		}
		var taken = recordedKeys(ownerId, candidates);
		return candidates.stream()
			.filter(e -> !taken.containsKey(WorkRecordService.key(e.scheduleId(), e.key())))
			.min(Comparator.comparing(Ended::startAt).thenComparing(Ended::scheduleId))
			.orElse(null);
	}

	/** 회차 키 → 그 회차 기록의 (상태, 보관 여부, id). 상태·보관과 관계없이 모두. */
	Map<String, Recorded> recordedKeys(UUID ownerId, List<Ended> occurrences) {
		List<UUID> scheduleIds = occurrences.stream().map(Ended::scheduleId).distinct().toList();
		return jdbc.sql("""
				SELECT id, schedule_id, occurrence_start, status, deleted_at IS NOT NULL AS deleted
				FROM work_record WHERE owner_id = :owner AND schedule_id IN (:ids)""")
			.param("owner", ownerId).param("ids", scheduleIds)
			.query((rs, i) -> new Recorded(WorkRecordService.key(rs.getObject("schedule_id", UUID.class),
					rs.getObject("occurrence_start", OffsetDateTime.class).toInstant()),
					rs.getObject("id", UUID.class), Status.valueOf(rs.getString("status")), rs.getBoolean("deleted")))
			.list().stream().collect(Collectors.toMap(Recorded::key, x -> x));
	}

	record Recorded(String key, UUID id, Status status, boolean deleted) {
	}

	/** 같은 사용자의 시작·정지를 트랜잭션 끝까지 한 줄로 세운다. */
	private void lock(UUID ownerId) {
		jdbc.sql("SELECT pg_advisory_xact_lock(?)")
			.param(ownerId.getMostSignificantBits() ^ ownerId.getLeastSignificantBits())
			.query((rs, i) -> 1).list();
	}
}

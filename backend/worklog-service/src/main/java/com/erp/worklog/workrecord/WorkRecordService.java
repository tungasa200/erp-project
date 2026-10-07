package com.erp.worklog.workrecord;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import com.erp.worklog.workrecord.WorkRecord.Outcome;
import com.erp.worklog.workrecord.WorkRecord.Status;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/** 업무 기록 (P2-01, REC-01·02). 확인 대기(PENDING) 생성은 P2-03. 요청 하나가 한 트랜잭션이다. */
@Service
class WorkRecordService {

	static final int MAX_RANGE_DAYS = 400;

	record RecordInfo(UUID id, String status, LocalDate workDate, String content, UUID taskId, UUID scheduleId,
			Instant occurrenceStart, String result, String outcome, Integer progress, Instant startAt, Instant endAt,
			Integer durationMin, List<UUID> tagIds, UUID projectId, Instant deletedAt, Instant createdAt, Instant updatedAt,
			long version) {
	}

	record NewRecord(String content, LocalDate workDate, UUID taskId, String result, String outcome, Integer progress,
			Instant startAt, Instant endAt, Integer durationMin) {
	}

	/** null은 보내지 않은 칸. nullable 칸의 Optional.empty()는 비우기. */
	record Change(long version, String status, String content, LocalDate workDate, Optional<UUID> taskId,
			Optional<String> result, Optional<String> outcome, Optional<Integer> progress, Optional<Instant> startAt,
			Optional<Instant> endAt, Optional<Integer> durationMin) {
	}

	/** 바꾼 뒤의 값 한 벌. 검사는 이 값으로 한다. */
	private record Values(String content, String result, Outcome outcome, Integer progress, Instant startAt,
			Instant endAt, Integer durationMin, boolean durationSent) {
	}

	private final WorkRecordRepository records;
	private final JdbcClient jdbc;
	private final Clock clock;

	WorkRecordService(WorkRecordRepository records, JdbcClient jdbc, Clock clock) {
		this.records = records;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	List<RecordInfo> list(UUID ownerId, LocalDate from, LocalDate to, Collection<String> statuses, UUID taskId) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (from == null) {
			errors.add(error("from", "REQUIRED"));
		}
		if (to == null) {
			errors.add(error("to", "REQUIRED"));
		}
		else if (from != null && to.isBefore(from)) {
			errors.add(error("to", "INVALID_ORDER"));
		}
		else if (from != null && ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS) {
			errors.add(error("to", "OUT_OF_RANGE"));
		}
		EnumSet<Status> wanted = EnumSet.noneOf(Status.class);
		for (String s : statuses) {
			try {
				wanted.add(Status.valueOf(s));
			} catch (IllegalArgumentException e) {
				errors.add(error("status", "INVALID_FORMAT"));
				break;
			}
		}
		throwIfAny(errors);
		if (wanted.isEmpty()) {
			wanted = EnumSet.allOf(Status.class);
		}
		return infos(records.findInRange(ownerId, from, to, wanted, taskId));
	}

	@Transactional(readOnly = true)
	RecordInfo get(UUID ownerId, UUID id) {
		return infos(List.of(find(ownerId, id))).getFirst();
	}

	/** 직접 쓴 기록. timezone은 startAt이 있을 때만 부른다(프로필 조회). */
	@Transactional
	RecordInfo create(UUID ownerId, Supplier<String> timezone, NewRecord n) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		Values v = check(new Values(n.content(), n.result(), outcome(n.outcome(), errors), n.progress(), n.startAt(),
				n.endAt(), n.durationMin(), n.durationMin() != null), errors);
		if (n.startAt() == null && n.workDate() == null) {
			errors.add(error("workDate", "REQUIRED"));
		}
		if (n.taskId() != null) {
			checkTask(ownerId, n.taskId(), errors);
		}
		throwIfAny(errors);

		Instant now = clock.instant();
		WorkRecord r = new WorkRecord(ownerId, now);
		r.content(v.content());
		r.taskId(n.taskId());
		r.result(v.result(), v.outcome(), v.progress());
		r.time(v.startAt(), v.endAt(), v.durationMin());
		r.workDate(v.startAt() != null ? dateOf(v.startAt(), timezone) : n.workDate());
		return infos(List.of(records.saveAndFlush(r))).getFirst();
	}

	@Transactional
	RecordInfo update(UUID ownerId, UUID id, Supplier<String> timezone, Change c) {
		WorkRecord r = find(ownerId, id);
		if (r.deletedAt() != null) {
			throw new ApiException(HttpStatus.CONFLICT, "RECORD_DELETED", "보관한 기록이에요. 복원한 뒤 고쳐 주세요.");
		}
		if (r.version() != c.version()) {
			throw Conflicts.versionConflict();
		}
		Status status = c.status() == null ? r.status() : Status.valueOf(c.status());
		if (!r.fromPlan() && status != Status.CONFIRMED) {
			throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATUS", "직접 쓴 기록은 상태를 바꿀 수 없어요. 지우려면 삭제해 주세요.");
		}
		List<FieldErrorDetail> errors = new ArrayList<>();
		Outcome outcome = c.outcome() == null ? r.outcome() : outcome(c.outcome().orElse(null), errors);
		Values v = check(new Values(c.content() == null ? r.content() : c.content(),
				c.result() == null ? r.result() : c.result().orElse(null), outcome,
				c.progress() == null ? r.progress() : c.progress().orElse(null),
				c.startAt() == null ? r.startAt() : c.startAt().orElse(null),
				c.endAt() == null ? r.endAt() : c.endAt().orElse(null),
				c.durationMin() == null ? r.durationMin() : c.durationMin().orElse(null),
				c.durationMin() != null && c.durationMin().isPresent()), errors);
		UUID taskId = c.taskId() == null ? r.taskId() : c.taskId().orElse(null);
		if (taskId != null && !taskId.equals(r.taskId())) {
			checkTask(ownerId, taskId, errors);
		}
		throwIfAny(errors);

		RecordInfo before = infos(List.of(r)).getFirst();
		// 날짜 귀속(D-40): startAt이 바뀔 때만 다시 계산한다. 시간대를 바꿔도 이미 저장한 날짜는 그대로다.
		if (v.startAt() != null && !v.startAt().equals(r.startAt())) {
			r.workDate(dateOf(v.startAt(), timezone));
		}
		else if (v.startAt() == null && c.workDate() != null) {
			r.workDate(c.workDate());
		}
		r.status(status);
		r.content(v.content());
		r.taskId(taskId);
		r.result(v.result(), v.outcome(), v.progress());
		r.time(v.startAt(), v.endAt(), v.durationMin());
		// 바뀐 칸이 없으면 수정 시각·version을 그대로 둔다 (자동 저장이 같은 값을 다시 보내도 충돌을 만들지 않게)
		if (!infos(List.of(r)).getFirst().equals(before)) {
			r.touch(clock.instant());
		}
		return infos(List.of(records.saveAndFlush(r))).getFirst();
	}

	/** 보관. 이미 보관했으면 그대로 둔다 (멱등). 행이 남아 같은 회차의 확인 대기가 다시 생기지 않는다. */
	@Transactional
	void delete(UUID ownerId, UUID id) {
		find(ownerId, id).delete(clock.instant());
	}

	@Transactional
	RecordInfo restore(UUID ownerId, UUID id) {
		WorkRecord r = find(ownerId, id);
		r.restore(clock.instant());
		return infos(List.of(records.saveAndFlush(r))).getFirst();
	}

	private WorkRecord find(UUID ownerId, UUID id) {
		return records.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
	}

	/**
	 * 내용·결과·시간 칸 검사 (WorkRecordCreate 규칙). 내용·결과는 앞뒤 공백을 빼고, 빈 결과는 비운다.
	 * startAt이 있으면 소요시간은 서버가 계산하고(endAt이 없으면 진행 중이라 null), 없을 때만 보낸 값을 쓴다.
	 */
	private static Values check(Values v, List<FieldErrorDetail> errors) {
		String content = v.content() == null ? "" : v.content().strip();
		if (content.isEmpty()) {
			errors.add(error("content", "REQUIRED"));
		}
		String result = v.result() == null || v.result().isBlank() ? null : v.result().strip();
		Integer progress = v.progress();
		if (progress != null) {
			if (v.outcome() != Outcome.IN_PROGRESS) {
				errors.add(error("progress", "INVALID_FORMAT"));
			}
			else if (progress < 0 || progress > 100 || progress % 10 != 0) {
				errors.add(error("progress", "OUT_OF_RANGE"));
			}
		}
		Integer duration = v.durationMin();
		if (v.startAt() != null) {
			if (v.durationSent()) {
				errors.add(error("durationMin", "INVALID_FORMAT"));
			}
			duration = null;
			if (v.endAt() != null) {
				if (!v.endAt().isAfter(v.startAt())) {
					errors.add(error("endAt", "INVALID_ORDER"));
				}
				else {
					long minutes = Duration.between(v.startAt(), v.endAt()).toMinutes();
					if (minutes < 1 || minutes > 1440) {
						errors.add(error("endAt", "OUT_OF_RANGE"));
					}
					duration = (int) minutes;
				}
			}
		}
		else {
			if (v.endAt() != null) {
				errors.add(error("endAt", "INVALID_ORDER"));
			}
			if (duration != null && (duration < 1 || duration > 1440)) {
				errors.add(error("durationMin", "OUT_OF_RANGE"));
			}
		}
		return new Values(content, result, v.outcome(), progress, v.startAt(), v.endAt(), duration, v.durationSent());
	}

	private static Outcome outcome(String value, List<FieldErrorDetail> errors) {
		if (value == null) {
			return null;
		}
		try {
			return Outcome.valueOf(value);
		} catch (IllegalArgumentException e) {
			errors.add(error("outcome", "INVALID_FORMAT"));
			return null;
		}
	}

	private static LocalDate dateOf(Instant at, Supplier<String> timezone) {
		return LocalDate.ofInstant(at, ZoneId.of(timezone.get()));
	}

	/** 보관하지 않은 내 업무여야 한다. 다른 사용자의 업무는 없는 것과 같다. */
	private void checkTask(UUID ownerId, UUID taskId, List<FieldErrorDetail> errors) {
		if (jdbc.sql("SELECT count(*) FROM task WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
				.params(taskId, ownerId).query(Long.class).single() == 0) {
			errors.add(error("taskId", "NOT_FOUND"));
		}
	}

	/** 연결 업무의 프로젝트·태그를 한 번에 붙인다. */
	private List<RecordInfo> infos(List<WorkRecord> found) {
		List<UUID> taskIds = found.stream().map(WorkRecord::taskId).filter(Objects::nonNull).distinct().toList();
		Map<UUID, UUID> projects = new HashMap<>();
		Map<UUID, List<UUID>> tags = new HashMap<>();
		if (!taskIds.isEmpty()) {
			jdbc.sql("SELECT id, project_id FROM task WHERE id IN (:ids)").param("ids", taskIds)
					.query((rs, i) -> {
						projects.put(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class));
						return null;
					}).list();
			jdbc.sql("SELECT task_id, tag_id FROM task_tag WHERE task_id IN (:ids) ORDER BY tag_id").param("ids", taskIds)
					.query((rs, i) -> {
						tags.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class));
						return null;
					}).list();
		}
		return found.stream().map(r -> new RecordInfo(r.id(), r.status().name(), r.workDate(), r.content(), r.taskId(),
				r.scheduleId(), r.occurrenceStart(), r.result(), r.outcome() == null ? null : r.outcome().name(),
				r.progress(), r.startAt(), r.endAt(), r.durationMin(),
				r.taskId() == null ? List.of() : tags.getOrDefault(r.taskId(), List.of()),
				r.taskId() == null ? null : projects.get(r.taskId()), r.deletedAt(), r.createdAt(), r.updatedAt(),
				r.version())).toList();
	}

	private static FieldErrorDetail error(String field, String code) {
		return new FieldErrorDetail(field, code, null);
	}

	private static void throwIfAny(List<FieldErrorDetail> errors) {
		if (!errors.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.", errors,
					Map.of());
		}
	}
}

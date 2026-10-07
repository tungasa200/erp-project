package com.erp.worklog.workrecord;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import com.erp.worklog.schedule.EndedOccurrences;
import com.erp.worklog.schedule.EndedOccurrences.Ended;
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
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/** 업무 기록 (P2-01, REC-01·02)과 확인 대기 생성·모두 했어요 (P2-03, REC-03). 요청 하나가 한 트랜잭션이다. */
@Service
class WorkRecordService {

	static final int MAX_RANGE_DAYS = 400;
	/** 홈 확인 대기 범위: 오늘을 포함한 최근 7일 (D-39). */
	static final int PENDING_DAYS = 7;

	record RecordInfo(UUID id, String status, LocalDate workDate, String content, UUID taskId, UUID scheduleId,
			Instant occurrenceStart, String result, String outcome, Integer progress, Instant startAt, Instant endAt,
			Integer durationMin, List<UUID> tagIds, UUID projectId, Instant deletedAt, Instant createdAt, Instant updatedAt,
			long version) {
	}

	/** 확인 대기 목록 항목: 기록과 지금의 계획(회차). */
	record PendingInfo(RecordInfo record, Ended plan) {
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
	private final EndedOccurrences occurrences;
	private final JdbcClient jdbc;
	private final Clock clock;

	WorkRecordService(WorkRecordRepository records, EndedOccurrences occurrences, JdbcClient jdbc, Clock clock) {
		this.records = records;
		this.occurrences = occurrences;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	/** from과 to가 같은 날이면(일 보기) 그날 끝난 회차의 확인 대기를 먼저 만든다 (7일 범위와 관계없이, D-39). */
	@Transactional
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
		if (from.equals(to)) {
			generate(ownerId, from, to);
		}
		return infos(records.findInRange(ownerId, from, to, wanted, taskId));
	}

	/** 최근 7일의 끝난 회차에서 확인 대기를 만들고, 그 범위의 확인 대기 기록을 계획 값과 함께 준다. */
	@Transactional
	List<PendingInfo> pending(UUID ownerId, Supplier<String> timezone) {
		LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneId.of(timezone.get()));
		LocalDate from = today.minusDays(PENDING_DAYS - 1);
		Map<String, Ended> plans = generate(ownerId, from, today);
		List<WorkRecord> found = records.findInRange(ownerId, from, today, EnumSet.of(Status.PENDING), null);
		List<RecordInfo> infos = infos(found);
		List<PendingInfo> result = new ArrayList<>();
		for (RecordInfo r : infos) {
			Ended plan = r.scheduleId() == null ? null : plans.get(key(r.scheduleId(), r.occurrenceStart()));
			// 회차를 옮기거나 지우면 그 확인 대기는 지워지므로 계획이 없는 확인 대기는 없다. 있더라도 계획 시간을 그릴 수 없어 뺀다
			if (plan != null) {
				result.add(new PendingInfo(r, plan));
			}
		}
		return result;
	}

	/**
	 * 모두 했어요. 보낸 id 중 최근 7일의 확인 대기만 확정하고 나머지(처리함·보관함·범위 밖·남의 것)는 건너뛴다.
	 * 화면에 보인 것만 확정한다(목록 뒤에 생긴 확인 대기는 사람이 보지 않았다, REC-03).
	 */
	@Transactional
	List<RecordInfo> confirmPending(UUID ownerId, Supplier<String> timezone, Collection<UUID> ids) {
		LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneId.of(timezone.get()));
		OffsetDateTime now = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
		List<UUID> confirmed = jdbc.sql("""
				UPDATE work_record SET status = 'CONFIRMED', version = version + 1, updated_at = :now
				WHERE owner_id = :owner AND id IN (:ids) AND status = 'PENDING' AND deleted_at IS NULL
				  AND work_date BETWEEN :from AND :to
				RETURNING id""")
				.param("now", now).param("owner", ownerId).param("ids", ids)
				.param("from", today.minusDays(PENDING_DAYS - 1)).param("to", today)
				.query(UUID.class).list();
		if (confirmed.isEmpty()) {
			return List.of();
		}
		List<WorkRecord> found = new ArrayList<>(records.findAllById(confirmed));
		found.sort(Comparator.<WorkRecord, LocalDate>comparing(WorkRecord::workDate)
				.thenComparing(WorkRecord::occurrenceStart, Comparator.nullsLast(Comparator.naturalOrder()))
				.thenComparing(WorkRecord::id));
		return infos(found);
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

	/**
	 * [from, to]에 끝난 회차 중 업무가 연결되고 그 업무가 보관되지 않은 것의 확인 대기를 만든다 (D-31, 보여줄 때 생성).
	 * (일정, 회차 시작) UNIQUE라 이미 있으면(상태·보관과 관계없이) 그대로 두고, 동시에 불려도 하나만 생긴다.
	 * 시간 칸은 비운다(계획 시간은 실제 시간이 아니다). 찾은 회차를 (일정, 회차 키)로 돌려준다.
	 */
	private Map<String, Ended> generate(UUID ownerId, LocalDate from, LocalDate to) {
		Instant now = clock.instant();
		List<Ended> ended = occurrences.find(ownerId, from, to, now);
		Map<String, Ended> plans = new HashMap<>();
		for (Ended e : ended) {
			plans.put(key(e.scheduleId(), e.key()), e);
		}
		List<UUID> taskIds = ended.stream().map(Ended::taskId).filter(Objects::nonNull).distinct().toList();
		if (taskIds.isEmpty()) {
			return plans;
		}
		Set<UUID> liveTasks = new HashSet<>(jdbc.sql("SELECT id FROM task WHERE id IN (:ids) AND owner_id = :owner AND deleted_at IS NULL")
				.param("ids", taskIds).param("owner", ownerId).query(UUID.class).list());
		OffsetDateTime at = OffsetDateTime.ofInstant(now, ZoneOffset.UTC);
		for (Ended e : ended) {
			if (e.taskId() == null || !liveTasks.contains(e.taskId())) {
				continue;
			}
			jdbc.sql("""
					INSERT INTO work_record (id, owner_id, task_id, schedule_id, occurrence_start, status, work_date, content,
					                         version, created_at, updated_at)
					VALUES (:id, :owner, :task, :schedule, :key, 'PENDING', :date, :content, 0, :now, :now)
					ON CONFLICT (schedule_id, occurrence_start) DO NOTHING""")
					.param("id", uuidV7(now)).param("owner", ownerId).param("task", e.taskId())
					.param("schedule", e.scheduleId()).param("key", OffsetDateTime.ofInstant(e.key(), ZoneOffset.UTC))
					.param("date", e.workDate()).param("content", e.title()).param("now", at)
					.update();
		}
		return plans;
	}

	private static String key(UUID scheduleId, Instant occurrenceStart) {
		return scheduleId + "@" + occurrenceStart;
	}

	/** JPA 밖에서 넣는 행의 id. 앞 48비트가 만든 밀리초인 UUIDv7 (RFC 9562). */
	private static UUID uuidV7(Instant now) {
		ThreadLocalRandom random = ThreadLocalRandom.current();
		long high = (now.toEpochMilli() << 16) | 0x7000L | (random.nextLong() & 0xFFFL);
		long low = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | Long.MIN_VALUE;
		return new UUID(high, low);
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

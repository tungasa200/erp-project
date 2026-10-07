package com.erp.worklog.schedule;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import com.erp.worklog.schedule.Recurrence.Frequency;
import com.erp.worklog.schedule.ScheduleDtos.OccurrenceView;
import com.erp.worklog.schedule.ScheduleDtos.RecurrenceDto;
import com.erp.worklog.schedule.ScheduleDtos.ScheduleCreate;
import com.erp.worklog.schedule.ScheduleDtos.ScheduleView;

/**
 * 일정 CRUD (P1-05)와 반복·회차 변경 (P1-06). 요청 하나가 한 트랜잭션이다 (D-53).
 */
@Service
class ScheduleService {

	static final Duration MAX_RANGE = Duration.ofDays(400);

	static final String NOT_RECURRING = "NOT_RECURRING";

	private final ScheduleRepository schedules;

	private final JdbcTemplate jdbc;

	private final Clock clock;

	ScheduleService(ScheduleRepository schedules, JdbcTemplate jdbc, Clock clock) {
		this.schedules = schedules;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	List<OccurrenceView> list(UUID ownerId, Instant from, Instant to, UUID taskId) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (from == null) {
			errors.add(error("from", "REQUIRED"));
		}
		if (to == null) {
			errors.add(error("to", "REQUIRED"));
		}
		else if (from != null && !to.isAfter(from)) {
			errors.add(error("to", "INVALID_ORDER"));
		}
		else if (from != null && Duration.between(from, to).compareTo(MAX_RANGE) > 0) {
			errors.add(error("to", "OUT_OF_RANGE"));
		}
		throwIfAny(errors);

		record Sorted(Instant start, OccurrenceView view) {
		}
		List<Schedule> found = schedules.findOverlapping(ownerId, from, to).stream()
				.filter(s -> taskId == null || taskId.equals(s.getTaskId()))
				.toList();
		Map<UUID, UUID> projects = projectsOf(found.stream().map(Schedule::getTaskId).filter(Objects::nonNull).toList());
		List<Sorted> result = new ArrayList<>();
		for (Schedule s : found) {
			ZoneId zone = ZoneId.of(s.getTimezone());
			UUID projectId = s.getTaskId() == null ? null : projects.get(s.getTaskId());
			for (Schedule.Occurrence o : s.occurrences(from, to)) {
				Instant start = o.allDay() ? o.startDate().atStartOfDay(zone).toInstant() : o.startAt();
				result.add(new Sorted(start, OccurrenceView.of(s, o, projectId)));
			}
		}
		result.sort(Comparator.comparing(Sorted::start).thenComparing(r -> r.view().scheduleId()));
		return result.stream().map(Sorted::view).toList();
	}

	@Transactional
	ScheduleView create(UUID ownerId, String timezone, ScheduleCreate c) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		String title = title(c.title(), errors);
		if (c.allDay() == null) {
			errors.add(error("allDay", "REQUIRED"));
		}
		Schedule.Timing timing = c.allDay() == null ? null
				: timing(c.allDay(), c.startAt(), c.endAt(), c.startDate(), c.endDate(), errors);
		Recurrence recurrence = recurrence(c.recurrence(), timing, ZoneId.of(timezone), errors);
		checkTask(ownerId, c.taskId(), errors);
		throwIfAny(errors);

		Instant now = clock.instant();
		Schedule s = new Schedule(ownerId, timezone, now);
		s.title(title);
		s.timing(timing, recurrence);
		s.taskId(c.taskId());
		s.memo(c.memo());
		s.touch(now);
		return ScheduleView.of(schedules.saveAndFlush(s));
	}

	@Transactional(readOnly = true)
	ScheduleView get(UUID ownerId, UUID id) {
		return ScheduleView.of(find(ownerId, id));
	}

	@Transactional
	ScheduleView update(UUID ownerId, UUID id, SchedulePatch p) {
		Schedule s = find(ownerId, id);
		if (!p.getVersion().equals(s.getVersion())) {
			throw Conflicts.versionConflict();
		}
		List<FieldErrorDetail> errors = new ArrayList<>();
		String title = p.getTitle() == null ? s.getTitle() : title(p.getTitle(), errors);

		// 종류가 그대로면 보내지 않은 칸은 지금 값, 종류가 바뀌면 새 종류의 칸은 반드시 보내야 한다.
		Schedule.Timing current = s.timing();
		boolean allDay = p.getAllDay() != null ? p.getAllDay() : current.allDay();
		boolean sameKind = allDay == current.allDay();
		Schedule.Timing timing = timing(allDay, p.startAtSent() ? p.getStartAt() : sameKind ? current.startAt() : null,
				p.endAtSent() ? p.getEndAt() : sameKind ? current.endAt() : null,
				p.startDateSent() ? p.getStartDate() : sameKind ? current.startDate() : null,
				p.endDateSent() ? p.getEndDate() : sameKind ? current.endDate() : null, errors);
		Recurrence recurrence = p.recurrenceSent()
				? recurrence(p.getRecurrence(), timing, ZoneId.of(s.getTimezone()), errors)
				: checkKeptRecurrence(s.recurrence(), timing, ZoneId.of(s.getTimezone()), errors);
		if (p.taskIdSent() && p.getTaskId() != null && !p.getTaskId().equals(s.getTaskId())) {
			checkTask(ownerId, p.getTaskId(), errors);
		}
		throwIfAny(errors);

		if (!timing.equals(current) || !Objects.equals(rrule(recurrence), rrule(s.recurrence()))) {
			deletePendingRecords(s.getId(), null); // 회차 키가 달라질 수 있으므로 이 일정의 확인 대기를 모두 지운다
		}
		s.title(title);
		s.timing(timing, recurrence);
		if (p.taskIdSent()) {
			s.taskId(p.getTaskId());
		}
		if (p.memoSent()) {
			s.memo(p.getMemo());
		}
		s.touch(clock.instant());
		return ScheduleView.of(schedules.saveAndFlush(s));
	}

	@Transactional
	void delete(UUID ownerId, UUID id) {
		Schedule s = find(ownerId, id);
		deletePendingRecords(s.getId(), null); // 나머지 기록은 work_record.schedule_id ON DELETE SET NULL로 남는다
		schedules.delete(s);
	}

	@Transactional
	OccurrenceView updateOccurrence(UUID ownerId, UUID id, Instant key, OccurrencePatch p) {
		Schedule s = find(ownerId, id);
		if (!s.recurring()) {
			throw notRecurring();
		}
		if (!p.getVersion().equals(s.getVersion())) {
			throw Conflicts.versionConflict();
		}
		if (!s.hasOccurrence(key)) {
			throw Errors.notFound();
		}
		Schedule.Occurrence current = s.occurrence(key);
		ScheduleOverride override = s.overrideOf(key) != null ? s.overrideOf(key) : ScheduleOverride.empty();
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (p.getTitle() != null) {
			override = override.withTitle(title(p.getTitle(), errors));
		}
		if (current.allDay()) {
			if (p.getStartAt() != null || p.getEndAt() != null) {
				errors.add(error(p.getStartAt() != null ? "startAt" : "endAt", "INVALID_FORMAT"));
			}
			if (p.getStartDate() != null || p.getEndDate() != null) {
				LocalDate start = p.getStartDate() != null ? p.getStartDate() : current.startDate();
				LocalDate end = p.getEndDate() != null ? p.getEndDate() : current.endDate();
				if (end.isBefore(start)) {
					errors.add(error("endDate", "INVALID_ORDER"));
				}
				override = override.withDates(start, end);
			}
		}
		else {
			if (p.getStartDate() != null || p.getEndDate() != null) {
				errors.add(error(p.getStartDate() != null ? "startDate" : "endDate", "INVALID_FORMAT"));
			}
			if (p.getStartAt() != null || p.getEndAt() != null) {
				Instant start = p.getStartAt() != null ? p.getStartAt() : current.startAt();
				Instant end = p.getEndAt() != null ? p.getEndAt() : current.endAt();
				if (!end.isAfter(start)) {
					errors.add(error("endAt", "INVALID_ORDER"));
				}
				override = override.withTimes(start, end);
			}
		}
		if (p.memoSent()) {
			override = override.withMemo(p.getMemo());
		}
		throwIfAny(errors);

		if (p.getStartAt() != null || p.getEndAt() != null || p.getStartDate() != null || p.getEndDate() != null) {
			deletePendingRecords(s.getId(), key);
		}
		s.override(key, override.copy());
		s.touch(clock.instant());
		Schedule saved = schedules.saveAndFlush(s);
		UUID projectId = saved.getTaskId() == null ? null
				: projectsOf(List.of(saved.getTaskId())).get(saved.getTaskId());
		return OccurrenceView.of(saved, saved.occurrence(key), projectId);
	}

	@Transactional
	void deleteOccurrence(UUID ownerId, UUID id, Instant key) {
		Schedule s = find(ownerId, id);
		if (!s.recurring()) {
			throw notRecurring();
		}
		ScheduleOverride existing = s.overrideOf(key);
		if (existing != null && existing.cancelled()) {
			return; // 이미 삭제한 회차
		}
		if (!s.hasOccurrence(key)) {
			throw Errors.notFound();
		}
		deletePendingRecords(s.getId(), key);
		s.override(key, ScheduleOverride.cancelledOccurrence());
		s.touch(clock.instant());
	}

	/**
	 * 일정을 지우거나 시각·반복을 바꾸면 그 일정(key가 있으면 그 회차)의 확인 대기(PENDING) 기록을 지운다 (P2-01 결정).
	 * 확정·하지 않음 기록은 사용자가 고른 것이라 남긴다.
	 */
	private void deletePendingRecords(UUID scheduleId, Instant key) {
		if (key == null) {
			jdbc.update("DELETE FROM work_record WHERE schedule_id = ? AND status = 'PENDING'", scheduleId);
		}
		else {
			jdbc.update("DELETE FROM work_record WHERE schedule_id = ? AND occurrence_start = ? AND status = 'PENDING'",
					scheduleId, java.sql.Timestamp.from(key));
		}
	}

	private static String rrule(Recurrence recurrence) {
		return recurrence == null ? null : recurrence.toRrule();
	}

	private Schedule find(UUID ownerId, UUID id) {
		return schedules.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
	}

	/** 앞뒤 공백을 뺀다. 비면 REQUIRED, 200자 넘으면 TOO_LONG. */
	private static String title(String raw, List<FieldErrorDetail> errors) {
		String title = raw == null ? "" : raw.strip();
		if (title.isEmpty()) {
			errors.add(error("title", "REQUIRED"));
		}
		else if (title.codePointCount(0, title.length()) > 200) {
			errors.add(error("title", "TOO_LONG"));
		}
		return title;
	}

	/** 종류에 맞는 두 칸은 필수, 다른 종류의 칸은 비어 있어야 한다. 오류가 있으면 null. */
	private static Schedule.Timing timing(boolean allDay, Instant startAt, Instant endAt, LocalDate startDate,
			LocalDate endDate, List<FieldErrorDetail> errors) {
		int before = errors.size();
		if (allDay) {
			requirePresent("startDate", startDate, errors);
			requirePresent("endDate", endDate, errors);
			requireAbsent("startAt", startAt, errors);
			requireAbsent("endAt", endAt, errors);
			if (startDate != null && endDate != null && endDate.isBefore(startDate)) {
				errors.add(error("endDate", "INVALID_ORDER"));
			}
		}
		else {
			requirePresent("startAt", startAt, errors);
			requirePresent("endAt", endAt, errors);
			requireAbsent("startDate", startDate, errors);
			requireAbsent("endDate", endDate, errors);
			if (startAt != null && endAt != null && !endAt.isAfter(startAt)) {
				errors.add(error("endAt", "INVALID_ORDER"));
			}
		}
		return errors.size() > before ? null
				: allDay ? new Schedule.Timing(true, null, null, startDate, endDate)
						: new Schedule.Timing(false, startAt, endAt, null, null);
	}

	/** 요청의 반복 규칙을 검사해 만든다. null이면 반복 없음. */
	private static Recurrence recurrence(RecurrenceDto dto, Schedule.Timing timing, ZoneId zone,
			List<FieldErrorDetail> errors) {
		if (dto == null) {
			return null;
		}
		int before = errors.size();
		Frequency frequency = null;
		if (dto.frequency() == null) {
			errors.add(error("recurrence.frequency", "REQUIRED"));
		}
		else {
			try {
				frequency = Frequency.valueOf(dto.frequency());
			}
			catch (IllegalArgumentException ex) {
				errors.add(error("recurrence.frequency", "INVALID_FORMAT"));
			}
		}
		Set<DayOfWeek> weekdays = EnumSet.noneOf(DayOfWeek.class);
		if (dto.weekdays() != null) {
			for (String day : dto.weekdays()) {
				try {
					weekdays.add(DayOfWeek.valueOf(day));
				}
				catch (IllegalArgumentException | NullPointerException ex) {
					errors.add(error("recurrence.weekdays", "INVALID_FORMAT"));
					break;
				}
			}
		}
		if (frequency == Frequency.WEEKLY && weekdays.isEmpty()) {
			errors.add(error("recurrence.weekdays", "REQUIRED"));
		}
		if (frequency != null && frequency != Frequency.WEEKLY && !weekdays.isEmpty()) {
			errors.add(error("recurrence.weekdays", "INVALID_FORMAT"));
		}
		if (dto.until() != null && dto.count() != null) {
			errors.add(error("recurrence.count", "INVALID_FORMAT"));
		}
		if (dto.count() != null && (dto.count() < 1 || dto.count() > 999)) {
			errors.add(error("recurrence.count", "OUT_OF_RANGE"));
		}
		if (errors.size() > before) {
			return null;
		}
		Recurrence recurrence = new Recurrence(frequency, weekdays, dto.until(), dto.count());
		return checkKeptRecurrence(recurrence, timing, zone, errors);
	}

	/** 시작일과 맞는지: 매주는 시작일 요일 포함, until은 시작일 이후. 시각에 오류가 있으면 건너뛴다. */
	private static Recurrence checkKeptRecurrence(Recurrence recurrence, Schedule.Timing timing, ZoneId zone,
			List<FieldErrorDetail> errors) {
		if (recurrence == null || timing == null) {
			return recurrence;
		}
		LocalDate first = timing.allDay() ? timing.startDate() : LocalDate.ofInstant(timing.startAt(), zone);
		if (!recurrence.admitsStart(first)) {
			errors.add(error("recurrence.weekdays", "OUT_OF_RANGE"));
		}
		if (recurrence.until() != null && recurrence.until().isBefore(first)) {
			errors.add(error("recurrence.until", "OUT_OF_RANGE"));
		}
		return recurrence;
	}

	/** 연결 업무는 보관하지 않은 내 업무여야 한다. */
	private void checkTask(UUID ownerId, UUID taskId, List<FieldErrorDetail> errors) {
		if (taskId == null) {
			return;
		}
		Integer found = jdbc.queryForObject(
				"SELECT count(*) FROM task WHERE id = ? AND owner_id = ? AND deleted_at IS NULL", Integer.class, taskId,
				ownerId);
		if (found == null || found == 0) {
			errors.add(error("taskId", "NOT_FOUND"));
		}
	}

	/** 연결 업무 → 그 업무의 프로젝트 (프로젝트가 없는 업무는 빠진다). 보관한 업무도 포함한다. 한 번의 조회로 묶는다. */
	private Map<UUID, UUID> projectsOf(List<UUID> taskIds) {
		if (taskIds.isEmpty()) {
			return Map.of();
		}
		Map<UUID, UUID> projects = new HashMap<>();
		jdbc.query("SELECT id, project_id FROM task WHERE id = ANY (?) AND project_id IS NOT NULL", rs -> {
			projects.put(rs.getObject("id", UUID.class), rs.getObject("project_id", UUID.class));
		}, (Object) taskIds.stream().distinct().toArray(UUID[]::new));
		return projects;
	}

	private static void requirePresent(String field, Object value, List<FieldErrorDetail> errors) {
		if (value == null) {
			errors.add(error(field, "REQUIRED"));
		}
	}

	private static void requireAbsent(String field, Object value, List<FieldErrorDetail> errors) {
		if (value != null) {
			errors.add(error(field, "INVALID_FORMAT"));
		}
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

	private static ApiException notRecurring() {
		return new ApiException(HttpStatus.CONFLICT, NOT_RECURRING, "반복 일정이 아니에요. 일정 전체를 수정해 주세요.");
	}

}

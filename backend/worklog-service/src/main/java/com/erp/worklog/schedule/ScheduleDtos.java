package com.erp.worklog.schedule;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;

/**
 * /api/worklog/schedules 요청·응답 형태 (contracts/worklog.yaml schedules). 검증 message에 errors[].code를 쓴다.
 * 여러 칸에 걸친 규칙(시각 종류·순서·반복)은 ScheduleService가 검사한다.
 */
final class ScheduleDtos {

	private ScheduleDtos() {
	}

	@Schema(name = "Recurrence", description = """
			반복 규칙 (SCH-03). 첫 회차는 항상 일정의 시작이라 매주는 weekdays에 시작일의 요일이 있어야 한다.
			매월은 시작일과 같은 날짜이며 그 날짜가 없는 달은 건너뛴다. until과 count는 함께 쓸 수 없고, 둘 다 없으면 끝없이 반복한다.""")
	record RecurrenceDto(
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "DAILY", "WEEKLY", "MONTHLY" }) String frequency,
			@ArraySchema(arraySchema = @Schema(description = "WEEKLY에서만, 1개 이상 필수"), schema = @Schema(
					allowableValues = { "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY" }))
			List<String> weekdays,
			@Schema(types = { "string", "null" }, format = "date", description = "이 날짜(일정 시간대)까지의 회차 포함") LocalDate until,
			@Schema(types = { "integer", "null" }, minimum = "1", maximum = "999", description = "회차 수 (삭제한 회차도 센다)")
			Integer count) {

		static RecurrenceDto of(Recurrence r) {
			return r == null ? null
					: new RecurrenceDto(r.frequency().name(), r.weekdaysInOrder().stream().map(Enum::name).toList(),
							r.until(), r.count());
		}
	}

	@Schema(name = "Schedule", description = "일정 원본. allDay=false면 startAt·endAt, true면 startDate·endDate(포함)만 값이 있다.")
	record ScheduleView(@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 200) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean allDay,
			@Schema(types = { "string", "null" }, format = "date-time") Instant startAt,
			@Schema(types = { "string", "null" }, format = "date-time") Instant endAt,
			@Schema(types = { "string", "null" }, format = "date") LocalDate startDate,
			@Schema(types = { "string", "null" }, format = "date", description = "마지막 날 포함") LocalDate endDate,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					description = "반복 전개와 종일 날짜의 기준 IANA 시간대. 만들 때 사용자 시간대로 정해지며 바뀌지 않는다") String timezone,
			RecurrenceDto recurrence, // null 허용 명세는 ScheduleOpenApi
			@Schema(types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(types = { "string", "null" }, maxLength = 5000) String memo,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant updatedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static ScheduleView of(Schedule s) {
			Schedule.Timing t = s.timing();
			return new ScheduleView(s.getId(), s.getTitle(), t.allDay(), t.startAt(), t.endAt(), t.startDate(),
					t.endDate(), s.getTimezone(), RecurrenceDto.of(s.recurrence()), s.getTaskId(), s.getMemo(),
					s.getCreatedAt(), s.getUpdatedAt(), s.getVersion());
		}
	}

	@Schema(name = "Occurrence", description = """
			캘린더에 그리는 일정 회차 하나. 반복이 없는 일정도 회차 하나로 준다.
			occurrenceStart는 회차 키(원래 시작 시각, 종일은 원래 날짜의 일정 시간대 0시)이며 회차를 옮겨도 바뀌지 않는다.""")
	record OccurrenceView(@Schema(requiredMode = RequiredMode.REQUIRED) UUID scheduleId,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant occurrenceStart,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "반복 일정의 회차인지") boolean recurring,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "\"이 일정만\"으로 바꾼 회차인지") boolean modified,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean allDay,
			@Schema(types = { "string", "null" }, format = "date-time") Instant startAt,
			@Schema(types = { "string", "null" }, format = "date-time") Instant endAt,
			@Schema(types = { "string", "null" }, format = "date") LocalDate startDate,
			@Schema(types = { "string", "null" }, format = "date") LocalDate endDate,
			@Schema(types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(types = { "string", "null" }, format = "uuid",
					description = "연결 업무의 프로젝트 (읽기 전용, 캘린더 프로젝트 필터·블록 색). 업무나 프로젝트가 없으면 null. 보관한 업무도 그 프로젝트를 준다")
			UUID projectId,
			@Schema(types = { "string", "null" }) String memo,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "일정(Schedule)의 version") long version) {

		static OccurrenceView of(Schedule s, Schedule.Occurrence o, UUID projectId) {
			return new OccurrenceView(s.getId(), o.key(), o.recurring(), o.modified(), o.title(), o.allDay(),
					o.startAt(), o.endAt(), o.startDate(), o.endDate(), s.getTaskId(), projectId, o.memo(),
					s.getVersion());
		}
	}

	record OccurrenceList(@Schema(requiredMode = RequiredMode.REQUIRED) List<OccurrenceView> items) {
	}

	@Schema(name = "ScheduleCreate", description = """
			allDay=false면 startAt·endAt 필수(endAt > startAt), true면 startDate·endDate 필수(endDate >= startDate).
			다른 종류의 두 칸은 보내지 않거나 null이어야 한다. taskId는 보관하지 않은 내 업무여야 한다.""")
	record ScheduleCreate(
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 200, description = "앞뒤 공백은 빼고 저장한다")
			@Size(max = 200, message = "TOO_LONG") String title,
			@Schema(requiredMode = RequiredMode.REQUIRED) Boolean allDay,
			@Schema(types = { "string", "null" }, format = "date-time") Instant startAt,
			@Schema(types = { "string", "null" }, format = "date-time") Instant endAt,
			@Schema(types = { "string", "null" }, format = "date") LocalDate startDate,
			@Schema(types = { "string", "null" }, format = "date") LocalDate endDate,
			@Valid RecurrenceDto recurrence, // null 허용 명세는 ScheduleOpenApi
			@Schema(types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(types = { "string", "null" }, maxLength = 5000) @Size(max = 5000, message = "TOO_LONG") String memo) {
	}

}

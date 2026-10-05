package com.erp.worklog.schedule;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.schedule.ScheduleDtos.OccurrenceList;
import com.erp.worklog.schedule.ScheduleDtos.OccurrenceView;
import com.erp.worklog.schedule.ScheduleDtos.ScheduleCreate;
import com.erp.worklog.schedule.ScheduleDtos.ScheduleView;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.user.UserProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/** /api/worklog/schedules (P1-05 일정 CRUD·종일, P1-06 반복, contracts/worklog.yaml). */
@RestController
@RequestMapping(path = "/api/worklog/schedules", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "schedules")
class ScheduleController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	private final ScheduleService schedules;

	private final UserProfileService profiles;

	ScheduleController(ScheduleService schedules, UserProfileService profiles) {
		this.schedules = schedules;
		this.profiles = profiles;
	}

	@GetMapping
	@Operation(operationId = "listOccurrences", summary = "기간 안의 일정 회차 (캘린더 일·주·월·연·목록 보기)",
			description = """
					[from, to)와 겹치는 회차를 시작 시각순으로 준다. 반복 일정은 회차로 전개하고, "이 일정만"으로 바꾼 회차는 바뀐 값으로,
					삭제한 회차는 빼고 준다. 종일 일정은 일정 시간대의 [startDate 0시, endDate 다음 날 0시)로 겹침을 판단한다. 기간은 최대 400일.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "from·to 누락(REQUIRED)·순서(INVALID_ORDER)·400일 초과(OUT_OF_RANGE)·형식 오류(INVALID_FORMAT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	OccurrenceList list(@Parameter(hidden = true) CurrentUser user,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
			@Parameter(description = "from보다 뒤, from + 400일 이내") @RequestParam(required = false)
			@DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
		return new OccurrenceList(schedules.list(user.id(), from, to));
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@ResponseStatus(HttpStatus.CREATED)
	@Operation(operationId = "createSchedule", summary = "일정 추가 (반복 포함)",
			description = "timezone은 사용자 프로필의 현재 시간대로 정해지며 바꿀 수 없다(반복 전개·종일 날짜의 기준, D-40).",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "201", description = "생성됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED, errors[].field는 recurrence.weekdays처럼 점으로 구분)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ScheduleView create(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody ScheduleCreate body) {
		String timezone = profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile().timezone();
		return schedules.create(user.id(), timezone, body);
	}

	@GetMapping("/{scheduleId}")
	@Operation(operationId = "getSchedule", summary = "일정 조회 (반복 일정은 원본 규칙)",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일정 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ScheduleView get(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID scheduleId) {
		return schedules.get(user.id(), scheduleId);
	}

	@PatchMapping(path = "/{scheduleId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateSchedule", summary = "일정 수정 — 반복 일정이면 \"모든 일정\" (SCR-CAL-08)",
			description = """
					보낸 칸만 바꾼다. 종일 여부를 바꾸면 새 종류의 시각 칸을 함께 보낸다. 반복 일정에서 시각이나 recurrence를 바꾸면
					회차별 변경·삭제를 모두 지운다. 제목·메모·연결 업무만 바꾸면 남는다. recurrence에 null을 보내면 반복을 없앤다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 전체")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일정 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "version 불일치 (code=VERSION_CONFLICT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ScheduleView update(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID scheduleId,
			@Valid @RequestBody SchedulePatch body) {
		return schedules.update(user.id(), scheduleId, body);
	}

	@DeleteMapping("/{scheduleId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deleteSchedule", summary = "일정 삭제 — 반복 일정이면 \"모든 일정\"",
			description = "일정과 회차 기록을 함께 지운다(되돌릴 수 없음). version을 받지 않는다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "삭제됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일정 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	void delete(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID scheduleId) {
		schedules.delete(user.id(), scheduleId);
	}

	@PatchMapping(path = "/{scheduleId}/occurrences/{occurrenceStart}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateOccurrence", summary = "반복 일정의 한 회차만 수정 — \"이 일정만\" (SCR-CAL-08, 블록 이동 포함)",
			description = """
					제목·메모·시각만 바꿀 수 있다(종일 여부·반복·연결 업무는 일정 전체 수정으로). 시각은 일정 종류에 맞는 칸만 받는다.
					version은 일정의 version이며 성공하면 오른다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정한 회차")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "404", description = "일정이 없거나 occurrenceStart가 그 일정의 회차가 아님(삭제한 회차 포함) (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "version 불일치(code=VERSION_CONFLICT) 또는 반복 일정이 아님(code=NOT_RECURRING)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	OccurrenceView updateOccurrence(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID scheduleId,
			@Parameter(description = "회차 키 (Occurrence.occurrenceStart를 그대로)") @PathVariable
			@DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant occurrenceStart,
			@Valid @RequestBody OccurrencePatch body) {
		return schedules.updateOccurrence(user.id(), scheduleId, occurrenceStart, body);
	}

	@DeleteMapping("/{scheduleId}/occurrences/{occurrenceStart}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deleteOccurrence", summary = "반복 일정의 한 회차만 삭제 — \"이 일정만\"",
			description = "그 회차를 목록에서 뺀다. 일정의 version이 오른다. version을 받지 않는다. 이미 삭제한 회차면 204.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "삭제됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일정, 또는 그 일정의 회차가 아님 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "반복 일정이 아님 (code=NOT_RECURRING)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	void deleteOccurrence(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID scheduleId,
			@PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant occurrenceStart) {
		schedules.deleteOccurrence(user.id(), scheduleId, occurrenceStart);
	}

}

package com.erp.worklog.workrecord;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.user.UserProfileService;
import com.erp.worklog.workrecord.WorkRecordService.RecordInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
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
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

/** /api/worklog/records (P2-01, contracts/worklog.yaml records). */
@RestController
@RequestMapping(path = "/api/worklog/records", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "records")
class WorkRecordController {

	static final String STATUS = "^(PENDING|CONFIRMED|DISMISSED)$";
	static final String OUTCOME = "^(DONE|REVIEW_REQUESTED|IN_PROGRESS)$";
	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	@Schema(name = "WorkRecord", description = """
			업무 기록 (REC-01, 요구사항 6장 WorkRecord). "무엇을 했고 결과가 어떤가".
			계획에서 온 기록은 scheduleId·occurrenceStart를 가진다(SCR-REC-01 ⑥ 출처 표시). 일정을 지우면 scheduleId는 null이 되고
			occurrenceStart는 남는다(출처 표시는 occurrenceStart로 판단). 시간 칸(startAt·endAt·durationMin)은 모두 null일 수 있다.""")
	record WorkRecordView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "PENDING", "CONFIRMED", "DISMISSED" },
					description = "확인 대기 / 확정 / 하지 않음 (REC-03). 일지와 자주 하는 업무 집계는 CONFIRMED만 쓴다") String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, format = "date",
					description = "귀속 날짜. 저장한 뒤 시간대를 바꿔도 바뀌지 않는다 (D-40)") LocalDate workDate,
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 500,
					description = "한 일. 확인 대기 기록은 만들 때 회차 제목을 복사한다") String content,
			@Schema(types = { "string", "null" }, format = "uuid",
					description = "연결 업무 (선택). 확인 대기 기록은 일정의 연결 업무를 복사한다. 업무를 보관해도 남는다") UUID taskId,
			@Schema(types = { "string", "null" }, format = "uuid") UUID scheduleId,
			@Schema(types = { "string", "null" }, format = "date-time",
					description = "회차 키 (Occurrence.occurrenceStart, D-71). (scheduleId, occurrenceStart)는 유일하다") Instant occurrenceStart,
			@Schema(types = { "string", "null" }, maxLength = 200, description = "결과 한 줄 (REC-02)") String result,
			@Schema(types = { "string", "null" }, allowableValues = { "DONE", "REVIEW_REQUESTED", "IN_PROGRESS" },
					description = "결과 칩 (REC-02) — 완료 / 검토 요청 / 진행 중(진행률 n%)") String outcome,
			@Schema(types = { "integer", "null" }, minimum = "0", maximum = "100", multipleOf = 10,
					description = "outcome=IN_PROGRESS일 때만 값이 있다") Integer progress,
			@Schema(types = { "string", "null" }, format = "date-time") Instant startAt,
			@Schema(types = { "string", "null" }, format = "date-time",
					description = "startAt보다 늦다. startAt만 있고 endAt이 null이면 진행 중(타이머, P2-06)") Instant endAt,
			@Schema(types = { "integer", "null" }, minimum = "1", maximum = "1440",
					description = "소요시간(분). startAt·endAt이 있으면 서버가 계산하고, 둘 다 없을 때만 직접 넣는다") Integer durationMin,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					description = "연결 업무의 태그 (읽기 전용, 일지·필터용). 업무가 없으면 빈 배열") List<UUID> tagIds,
			@Schema(types = { "string", "null" }, format = "uuid",
					description = "연결 업무의 프로젝트 (읽기 전용, 블록 색·일지 묶음)") UUID projectId,
			@Schema(types = { "string", "null" }, format = "date-time") Instant deletedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant updatedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static WorkRecordView of(RecordInfo r) {
			return new WorkRecordView(r.id(), r.status(), r.workDate(), r.content(), r.taskId(), r.scheduleId(),
					r.occurrenceStart(), r.result(), r.outcome(), r.progress(), r.startAt(), r.endAt(), r.durationMin(),
					r.tagIds(), r.projectId(), r.deletedAt(), r.createdAt(), r.updatedAt(), r.version());
		}
	}

	@Schema(name = "WorkRecordList")
	record WorkRecordList(@Schema(requiredMode = RequiredMode.REQUIRED) List<WorkRecordView> items) {
	}

	@Schema(name = "WorkRecordCreate", description = """
			startAt이 없으면 workDate 필수(REQUIRED). endAt은 startAt 없이 보낼 수 없고 startAt보다 늦어야 한다(INVALID_ORDER).
			durationMin은 startAt과 함께 보낼 수 없다(INVALID_FORMAT). progress는 outcome=IN_PROGRESS일 때만(INVALID_FORMAT).
			taskId는 보관하지 않은 내 업무여야 한다(NOT_FOUND). 내용·결과는 앞뒤 공백을 빼고 저장한다(빈 결과는 null).
			다른 기록과 시간이 겹쳐도 저장한다(겹침 경고는 화면이 같은 날 목록으로 계산, TIME-06).""")
	record WorkRecordCreate(
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 500)
			@NotNull(message = "REQUIRED") @Size(max = 500, message = "TOO_LONG") String content,
			@Schema(types = { "string", "null" }, format = "date") LocalDate workDate,
			@Schema(types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(types = { "string", "null" }, maxLength = 200) @Size(max = 200, message = "TOO_LONG") String result,
			@Schema(types = { "string", "null" }, allowableValues = { "DONE", "REVIEW_REQUESTED", "IN_PROGRESS" })
			@Pattern(regexp = OUTCOME, message = "INVALID_FORMAT") String outcome,
			@Schema(types = { "integer", "null" }, minimum = "0", maximum = "100", multipleOf = 10) Integer progress,
			@Schema(types = { "string", "null" }, format = "date-time") Instant startAt,
			@Schema(types = { "string", "null" }, format = "date-time") Instant endAt,
			@Schema(types = { "integer", "null" }, minimum = "1", maximum = "1440") Integer durationMin) {
	}

	private final WorkRecordService records;
	private final UserProfileService profiles;

	WorkRecordController(WorkRecordService records, UserProfileService profiles) {
		this.records = records;
		this.profiles = profiles;
	}

	@GetMapping
	@Operation(operationId = "listRecords", summary = "기간 안의 업무 기록 (일 보기 \"이날의 기록\", 업무 상세 기록 이력, 일지 원본)",
			description = """
					workDate가 [from, to](양끝 포함)인 기록을 준다. 보관(소프트 삭제)한 기록은 빼고 준다.
					정렬: workDate → startAt(없으면 뒤) → occurrenceStart(없으면 뒤) → id. 페이지네이션 없이 한 번에 준다(기간 최대 400일).
					status를 생략하면 세 상태를 모두 준다(일 보기는 확인 대기·하지 않음도 상태로 그린다, SCR-CAL-01 states).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkRecordList list(@Parameter(hidden = true) CurrentUser user,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
			@Parameter(required = true) LocalDate from,
			@Parameter(required = true, description = "from 이후(같아도 됨), from + 400일 이내")
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
			@Parameter(description = "여러 개면 OR",
					array = @ArraySchema(schema = @Schema(allowableValues = { "PENDING", "CONFIRMED", "DISMISSED" })))
			@RequestParam(name = "status", required = false) List<String> statuses,
			@Parameter(description = "이 업무에 연결된 기록만 (업무 상세 기록 이력). 다른 사용자·없는 업무면 빈 목록")
			@RequestParam(required = false) UUID taskId) {
		return new WorkRecordList(records.list(user.id(), from, to, statuses == null ? List.of() : statuses, taskId)
				.stream().map(WorkRecordView::of).toList());
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@ResponseStatus(HttpStatus.CREATED)
	@Operation(operationId = "createRecord", summary = "업무 기록 추가 — 직접 쓴 기록은 바로 확정 (REC-01, SCR-REC-01)",
			description = """
					사용자가 직접 쓴 기록이라 status=CONFIRMED로 만든다(확인 대기는 서버만 만든다, P2-03).
					날짜 귀속(D-40, NFR-04): startAt이 있으면 workDate는 저장 시점 사용자 시간대(프로필)로 startAt의 날짜를 계산하고
					보낸 workDate는 무시한다. startAt이 없으면 workDate가 필수다.
					시간 칸은 시간 기록 옵션(WorklogSettings.timeTrackingEnabled)과 관계없이 받는다(TIME-09).
					startAt이 있는데 프로필 사본이 없으면 identity에서 바로 가져온다(실패하면 503).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "201", description = "생성됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED). 참조한 업무가 없으면 errors[].code=NOT_FOUND",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkRecordView create(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody WorkRecordCreate body) {
		return WorkRecordView.of(records.create(user.id(), timezone(user, jwt), new WorkRecordService.NewRecord(
				body.content(), body.workDate(), body.taskId(), body.result(), body.outcome(), body.progress(),
				body.startAt(), body.endAt(), body.durationMin())));
	}

	@GetMapping("/{recordId}")
	@Operation(operationId = "getRecord", summary = "업무 기록 조회 (보관한 기록 포함)",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 기록 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkRecordView get(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID recordId) {
		return WorkRecordView.of(records.get(user.id(), recordId));
	}

	@PatchMapping(path = "/{recordId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateRecord", summary = "업무 기록 수정·확인·하지 않음 (SCR-REC-01, SCR-HOME-02 했어요/수정/안 했어요, 되돌리기)",
			description = """
					보낸 칸만 바꾼다. nullable 칸은 null을 보내면 비운다. 상태 전이:
					- 계획에서 온 기록(occurrenceStart가 있음): PENDING·CONFIRMED·DISMISSED 사이 어느 쪽으로든
					  (했어요 = CONFIRMED, 안 했어요 = DISMISSED, 되돌리기 토스트 = PENDING). "수정"은 내용과 status=CONFIRMED를 한 요청에 보낸다.
					- 직접 쓴 기록: CONFIRMED만(다른 값이면 409 INVALID_STATUS). 지우려면 DELETE.
					startAt을 바꾸면 workDate를 저장 시점 사용자 시간대로 다시 계산한다. startAt을 null로 비우면 workDate는 그대로 두거나 보낸 값으로 바꾼다.
					같은 값을 다시 보내면 version이 오르지 않는다. 보관한 기록은 수정할 수 없다(409 RECORD_DELETED, 먼저 복원).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 전체")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 기록 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409",
			description = "version 불일치(code=VERSION_CONFLICT), 직접 쓴 기록의 상태 변경(code=INVALID_STATUS), 보관한 기록(code=RECORD_DELETED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkRecordView update(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable UUID recordId, @Valid @RequestBody WorkRecordPatch body) {
		return WorkRecordView.of(records.update(user.id(), recordId, timezone(user, jwt), body.toChange()));
	}

	@DeleteMapping("/{recordId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deleteRecord", summary = "업무 기록 보관 (소프트 삭제, SCR-REC-01 ⑦)",
			description = """
					deletedAt을 기록한다. 이미 보관했으면 204. version을 받지 않는다.
					계획에서 온 기록은 보관해도 (일정, 회차 시작) 행이 남으므로 확인 대기가 다시 생기지 않는다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "보관됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 기록 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	void delete(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID recordId) {
		records.delete(user.id(), recordId);
	}

	@PostMapping("/{recordId}/restore")
	@Operation(operationId = "restoreRecord", summary = "보관한 기록 복원 (되돌리기 토스트)",
			description = "deletedAt을 비운다. 보관하지 않은 기록이면 그대로 200.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "복원 후 전체")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 기록 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkRecordView restore(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID recordId) {
		return WorkRecordView.of(records.restore(user.id(), recordId));
	}

	/** 시간대는 startAt으로 날짜를 계산할 때만 필요하므로 그때 프로필을 읽는다. */
	private Supplier<String> timezone(CurrentUser user, Jwt jwt) {
		return () -> profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile().timezone();
	}
}

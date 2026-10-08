package com.erp.worklog.journal;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.journal.LogViews.RevisionDetail;
import com.erp.worklog.journal.LogViews.RevisionList;
import com.erp.worklog.journal.LogViews.VersionOnly;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.user.Profile;
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
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/** /api/worklog/logs — 일지 보기·초안·확정·이력 (P3-02·03, contracts/worklog.yaml logs). */
@RestController
@RequestMapping(path = "/api/worklog/logs", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "logs")
class WorkLogController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;
	private static final String TYPE = "경로에서는 소문자(daily·weekly·monthly) — 화면 경로 /logs/daily/:date와 맞춘다";
	private static final String PERIOD_START = "기간 시작일. 주간은 주 시작 요일의 날, 월간은 1일 (화면 경로 /logs/monthly/:yyyy-mm은 화면이 1일로 바꾼다)";

	private final WorkLogService logs;
	private final UserProfileService profiles;

	WorkLogController(WorkLogService logs, UserProfileService profiles) {
		this.logs = logs;
		this.profiles = profiles;
	}

	@GetMapping("/{type}/{periodStart}")
	@Operation(operationId = "getLog", summary = "일지 보기 — 없으면 저장하지 않은 미리보기 (P3-03·07 SCR-LOG-02, 홈 오늘 일지 카드 LOG-12)",
			description = """
					저장된 일지가 있으면 그 일지를, 없으면 원본으로 만든 미리보기(id=null, status=NOT_WRITTEN 또는 NO_RECORDS, version=0)를 준다.
					미리보기는 저장하지 않는다. 초안은 실적이 자동 상태면 읽을 때마다 원본으로 다시 만든다. 확정 일지는 스냅샷을 준다.
					일간 실적: 그날 확정 기록(보관·실행 중 타이머 제외)을 정렬 순서대로 한 줄씩(source=RECORD), 그날 완료한 업무 중
					그날 기록이 없는 업무는 업무 제목으로 한 줄(source=TASK, outcome=DONE). 확인 대기 기록은 metrics.pendingCount로만 센다.
					소요시간 표(time)는 시간 기록 옵션이 켜져 있을 때만. 계획은 비어서 시작하고 후보(planCandidates)를 준다.
					기간 시작일이 맞지 않으면 400(periodStart, INVALID_FORMAT).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "일지 또는 미리보기")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkLogView get(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Parameter(description = TYPE, schema = @Schema(allowableValues = { "daily", "weekly", "monthly" })) @PathVariable String type,
			@Parameter(description = PERIOD_START) @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart) {
		return logs.get(user.id(), profile(user, jwt), type, periodStart);
	}

	@PostMapping("/{type}/{periodStart}")
	@Operation(operationId = "createLog", summary = "초안 만들기 (SCR-LOG-01 미작성 날짜, LOG-16 주간·월간 제안 수락)",
			description = """
					그 기간의 초안을 만든다(실적 자동 상태, 계획·이슈 비움). 이미 있으면 만들지 않고 있는 일지를 200으로 준다(멱등).
					기간 시작일이 오늘(사용자 시간대)보다 뒤면 400(periodStart, OUT_OF_RANGE). 원본이 없어도 만들 수 있다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "이미 있던 일지")
	@ApiResponse(responseCode = "201", description = "만듦")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ResponseEntity<WorkLogView> create(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Parameter(description = TYPE, schema = @Schema(allowableValues = { "daily", "weekly", "monthly" })) @PathVariable String type,
			@Parameter(description = PERIOD_START) @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart) {
		WorkLogService.Created c = logs.create(user.id(), profile(user, jwt), type, periodStart);
		return ResponseEntity.status(c.created() ? HttpStatus.CREATED : HttpStatus.OK).body(c.log());
	}

	@PatchMapping(path = "/{logId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "patchLog", summary = "초안 고치기 — 자동 저장 (LOG-03·04, SCR-LOG-02)",
			description = """
					보낸 칸만 바꾼다. achievements를 보내면 실적이 자동 상태에서 벗어나 보낸 목록이 그대로 저장된다
					(행 추가·삭제·순서 변경은 목록 전체를 보낸다, 원본 기록 끌어오기는 recordIds를 단 행을 넣어 보낸다).
					plans·issues도 같다. 바뀐 칸이 없으면 version을 올리지 않는다. 확정한 일지는 409(code=LOG_CONFIRMED).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "고친 일지")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "VERSION_CONFLICT 또는 LOG_CONFIRMED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkLogView patch(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable UUID logId, @Valid @RequestBody LogViews.Patch body) {
		return logs.patch(user.id(), profile(user, jwt), logId, new WorkLogService.Change(body.getVersion(),
				body.getAchievements(), body.getPlans(), body.issuesSent(), body.getIssues()));
	}

	@PostMapping(path = "/{logId}/refill", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "refillLog", summary = "원본에서 다시 채우기 (LOG-04 — 화면이 경고창을 먼저 띄운다)",
			description = "실적을 자동 상태로 되돌린다(직접 고친 실적은 사라진다). 계획·이슈는 그대로 둔다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "다시 채운 일지")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "VERSION_CONFLICT 또는 LOG_CONFIRMED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkLogView refill(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable UUID logId, @Valid @RequestBody VersionOnly body) {
		return logs.refill(user.id(), profile(user, jwt), logId, body.version());
	}

	@PostMapping(path = "/{logId}/confirm", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "confirmLog", summary = "확정 — 스냅샷 저장 (LOG-05, P3-02)",
			description = """
					지금 보이는 내용 전체(머리의 작성자 이름·소속·직책 포함)를 스냅샷으로 저장하고 status=CONFIRMED, 변경 이력에 한 줄을 더한다.
					작성자 프로필이 비어 있어도 확정한다(빈칸). 이미 확정이면 409(LOG_CONFIRMED).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "확정한 일지")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "VERSION_CONFLICT 또는 LOG_CONFIRMED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkLogView confirm(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable UUID logId, @Valid @RequestBody VersionOnly body) {
		return logs.confirm(user.id(), profile(user, jwt), logId, body.version());
	}

	@PostMapping(path = "/{logId}/unconfirm", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "unconfirmLog", summary = "확정 해제 (LOG-06, SCR-LOG-04 — 화면이 확인창을 먼저 띄운다)",
			description = """
					status=DRAFT로 되돌리고 마지막 확정 이력에 해제 시각을 적는다. 내용은 확정본 그대로 초안이 된다(실적은 자동 상태가 아니다).
					원본으로 다시 만들려면 다시 채우기를 쓴다. 이미 초안이면 409(code=LOG_NOT_CONFIRMED).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "초안으로 돌린 일지")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "VERSION_CONFLICT 또는 LOG_NOT_CONFIRMED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	WorkLogView unconfirm(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable UUID logId, @Valid @RequestBody VersionOnly body) {
		return logs.unconfirm(user.id(), profile(user, jwt), logId, body.version());
	}

	@GetMapping("/{logId}/revisions")
	@Operation(operationId = "listLogRevisions", summary = "변경 이력 — 확정·해제 일시 (LOG-06, SCR-LOG-04 ②)",
			description = "확정할 때마다 한 줄. 최근 것부터. 초안 편집(자동 저장)은 이력에 남기지 않는다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "이력")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	RevisionList revisions(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID logId) {
		return new RevisionList(logs.revisions(user.id(), logId));
	}

	@GetMapping("/{logId}/revisions/{revisionNo}")
	@Operation(operationId = "getLogRevision", summary = "확정본 열람 (SCR-LOG-04 ②)",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "그때의 확정본")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 일지·이력 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	RevisionDetail revision(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID logId,
			@PathVariable int revisionNo) {
		return logs.revision(user.id(), logId, revisionNo);
	}

	private Profile profile(CurrentUser user, Jwt jwt) {
		return profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile();
	}
}

package com.erp.worklog.journal;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.error.Errors;
import com.erp.worklog.journal.DailyCloseService.ClosePlan;
import com.erp.worklog.journal.DailyCloseService.CloseRequest;
import com.erp.worklog.journal.DailyCloseService.CloseResult;
import com.erp.worklog.journal.DailyCloseService.PeriodList;
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
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/** /api/worklog/logs 목록 (P3-08)과 /logs/daily/{date}/close 하루 마감 (P3-05). */
@RestController
@RequestMapping(path = "/api/worklog/logs", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "logs")
class DailyCloseController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	private final DailyCloseService close;
	private final UserProfileService profiles;

	DailyCloseController(DailyCloseService close, UserProfileService profiles) {
		this.close = close;
		this.profiles = profiles;
	}

	@GetMapping
	@Operation(operationId = "listLogPeriods", summary = "일지 목록 — 기간별 상태 (P3-08 LOG-09 SCR-LOG-01, 홈 이번 주 현황 SCR-HOME-01 ⑦)",
			description = """
					[from, to] 안의 기간마다 한 줄을 준다. 일지가 없는 기간도 준다.
					type=DAILY: 날마다. WEEKLY: 겹치는 주(주 시작 요일 기준)마다. MONTHLY: 겹치는 달마다.
					status: CONFIRMED·DRAFT는 저장된 일지, NOT_WRITTEN은 일지 없이 원본(보관하지 않은 확정·확인 대기 기록, 그 기간 완료 업무)이 있음,
					NO_RECORDS는 일지도 원본도 없음(미래 포함). unconfirmedDays는 [from, min(to, 오늘)] 중 원본이 있는데 일간 일지가 확정이 아닌 날 수.
					기간은 최대 400일(넘으면 400 to OUT_OF_RANGE, to < from이면 400 to INVALID_ORDER). periodStart 오름차순.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "기간별 상태")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	PeriodList list(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Parameter(required = true, schema = @Schema(allowableValues = { "DAILY", "WEEKLY", "MONTHLY" })) @RequestParam String type,
			@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
		LogType logType;
		try {
			logType = LogType.valueOf(type);
		}
		catch (IllegalArgumentException e) {
			throw Errors.invalid("type", "INVALID_FORMAT", null);
		}
		return close.list(user.id(), profile(user, jwt), logType, from, to);
	}

	@GetMapping("/daily/{date}/close")
	@Operation(operationId = "getDailyClose", summary = "하루 마감 준비 — 2단계 이월 후보와 마감 뒤 제안 (LOG-13·14·16, SCR-LOG-03)",
			description = """
					1단계(확인 대기·빈 시간)는 GET /records/pending·/records/gaps를 쓴다. pendingCount가 0이면 화면은 1단계를 건너뛴다.
					이월 후보(LOG-14): 보관하지 않은 TODO·IN_PROGRESS 업무 중 ① 그날 확정 기록이 있거나 ② 마감일이 다음 근무일 이하이거나(지난 마감 포함)
					③ IN_PROGRESS인 업무. 늘 selected=true, 마감순(없으면 뒤) → 제목.
					nextWorkday는 date 다음 날부터 찾은 첫 근무일(LOG-13). planScope: 다음 근무일이 다음 주면 NEXT_WEEK, 아니면 NEXT_WORKDAY.
					suggestions: date가 근무일이고 그 주·그 달의 마지막 근무일일 때만, 주간 → 월간(LOG-16).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "마감 준비 정보")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ClosePlan plan(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
		return close.plan(user.id(), profile(user, jwt), date);
	}

	@PostMapping(path = "/daily/{date}/close", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "closeDay", summary = "하루 마감 — 이월·이슈를 넣고 일간 일지 확정 (LOG-13·14, SCR-LOG-03 3단계)",
			description = """
					한 트랜잭션으로: 그날 일간 초안이 없으면 만들고 → 선택한 업무를 계획에 더하고(같은 업무가 이미 있으면 그대로) →
					issue가 비어 있지 않으면 이슈 칸 끝에 한 줄로 덧붙이고 → 확정한다(스냅샷·이력). 업무 자체는 바꾸지 않는다.
					version은 일지가 없으면 0. 이미 확정이면 409(LOG_CONFIRMED), version이 다르면 409(VERSION_CONFLICT).
					오늘보다 뒤 날짜는 400(date, OUT_OF_RANGE). 내 것이 아니거나 보관한 업무는 400(carryOverTaskIds, NOT_FOUND).
					계획이 50개를 넘으면 400(carryOverTaskIds, TOO_MANY), 이슈가 2000자를 넘으면 400(issue, TOO_LONG).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "확정한 일간 일지와 이어서 할 제안")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409", description = "일지 상태 충돌 (code=LOG_CONFIRMED 또는 VERSION_CONFLICT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	CloseResult close(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
			@Valid @RequestBody CloseRequest body) {
		return close.close(user.id(), profile(user, jwt), date, body);
	}

	private Profile profile(CurrentUser user, Jwt jwt) {
		return profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile();
	}
}

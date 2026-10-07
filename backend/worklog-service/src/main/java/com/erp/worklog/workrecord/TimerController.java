package com.erp.worklog.workrecord;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.user.UserProfileService;
import com.erp.worklog.workrecord.TimeViews.PlanBlockView;
import com.erp.worklog.workrecord.TimeViews.TimerStartRequest;
import com.erp.worklog.workrecord.TimeViews.TimerStartResult;
import com.erp.worklog.workrecord.TimeViews.TimerStateView;
import com.erp.worklog.workrecord.TimeViews.TimerStopResult;
import com.erp.worklog.workrecord.TimeViews.TimerStoppedView;
import com.erp.worklog.workrecord.WorkRecordController.WorkRecordView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.function.Supplier;

/** /api/worklog/timer (P2-06, contracts/worklog.yaml timer). */
@RestController
@RequestMapping(path = "/api/worklog/timer", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "timer")
class TimerController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	private final TimerService timer;
	private final UserProfileService profiles;

	TimerController(TimerService timer, UserProfileService profiles) {
		this.timer = timer;
		this.profiles = profiles;
	}

	@GetMapping
	@Operation(operationId = "getTimer", summary = "지금 실행 중인 타이머 (SCR-COM-06)",
			description = """
					타이머는 따로 저장하지 않는다. 실행 중 타이머 = startAt이 있고 endAt·durationMin이 없는 보관하지 않은 기록.
					사용자당 하나뿐이다(DB 부분 UNIQUE, TIME-03). 브라우저를 닫아도 서버의 startAt 기준으로 이어진다.
					시간 기록 옵션이 꺼져 있어도 응답한다(TIME-09).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "running이 null이면 실행 중인 타이머 없음")
	TimerStateView get(@Parameter(hidden = true) CurrentUser user) {
		return new TimerStateView(timer.running(user.id()).map(WorkRecordView::of).orElse(null));
	}

	@PostMapping(path = "/start", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "startTimer", summary = "타이머 시작 — 실행 중인 타이머는 자동 정지 (TIME-03·10)",
			description = """
					한 트랜잭션에서 (1) 실행 중인 타이머가 있으면 지금 시각으로 정지하고(규칙은 /timer/stop과 같다)
					(2) startAt=지금, status=CONFIRMED인 기록을 만든다. workDate는 지금의 사용자 시간대 날짜(D-40).
					- taskId만: content는 업무 제목. content를 함께 보내면 그 값. content만: 업무 없이 시작.
					- scheduleId+occurrenceStart(이어달리기, TIME-10): 그 회차를 가져간다. 회차의 확인 대기 기록이 있으면 그 기록을
					  실행 중으로 바꾸고, 없으면 회차 키를 단 새 기록을 만든다(회차가 끝나도 확인 대기가 따로 생기지 않는다).
					  taskId·content를 안 보내면 회차의 업무·제목을 쓴다. 그 회차의 기록이 이미 확정·하지 않음·보관이면 409 ALREADY_RECORDED.
					시간 기록 옵션이 꺼져 있으면 409 TIME_TRACKING_DISABLED.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "새로 실행 중인 타이머와, 자동 정지한 앞 타이머(없으면 null)")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED). 업무가 없으면 errors[].code=NOT_FOUND",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "404", description = "회차(scheduleId·occurrenceStart)가 없거나 취소됨 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "409",
			description = "시간 기록 옵션 꺼짐(code=TIME_TRACKING_DISABLED), 그 회차는 이미 기록됨(code=ALREADY_RECORDED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	TimerStartResult start(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Valid @RequestBody TimerStartRequest body) {
		TimerService.Started s = timer.start(user.id(), timezone(user, jwt),
				new TimerService.Start(body.taskId(), body.content(), body.scheduleId(), body.occurrenceStart()));
		return new TimerStartResult(WorkRecordView.of(s.running()), TimerStoppedView.of(s.stopped()));
	}

	@PostMapping("/stop")
	@Operation(operationId = "stopTimer", summary = "타이머 정지 + 이어달리기 제안 (TIME-03·10)",
			description = """
					실행 중인 타이머의 endAt을 지금으로 채운다. 실행 중인 타이머가 없으면 stopped=null(멱등, 200).
					- 1분이 안 되면 버린다(discarded=true): 직접 시작한 기록은 지우고(하드 삭제), 회차를 가져간 기록은 시간 칸을 비워 확인 대기로 되돌린다.
					- 24시간을 넘으면 endAt=startAt+24시간으로 멈추고 capped=true(소요시간 최대 1440분). 화면은 안내 후 수정을 권한다.
					- 시간 기록 옵션과 관계없이 동작한다(꺼진 상태에서도 남은 타이머를 멈출 수 있게).
					이어달리기(next): 사용자 시간대 오늘과 겹치는 시간 일정 회차(종일·취소 제외) 중 끝 시각이 지금 이후이고
					아직 기록이 없는 것 하나 — 시작이 이른 순(지금 진행 중인 회차가 먼저). 업무가 없는 회차도 제안한다. 없으면 null.
					수락하면 화면이 /timer/start에 회차 키를 보낸다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "정지 결과와 이어달리기 제안")
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	TimerStopResult stop(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt) {
		TimerService.StopResult r = timer.stop(user.id(), timezone(user, jwt));
		return new TimerStopResult(TimerStoppedView.of(r.stopped()), PlanBlockView.of(r.next()));
	}

	private Supplier<String> timezone(CurrentUser user, Jwt jwt) {
		return () -> profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile().timezone();
	}
}

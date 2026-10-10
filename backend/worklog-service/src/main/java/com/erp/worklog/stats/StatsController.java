package com.erp.worklog.stats;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.stats.StatsService.Day;
import com.erp.worklog.stats.StatsService.ProjectRow;
import com.erp.worklog.stats.StatsService.TaskDiff;
import com.erp.worklog.stats.StatsService.Week;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** /api/worklog/stats (P4-02, contracts/worklog.yaml stats). */
@RestController
@RequestMapping(path = "/api/worklog/stats", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "stats")
class StatsController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	private final StatsService stats;
	private final UserProfileService profiles;

	StatsController(StatsService stats, UserProfileService profiles) {
		this.stats = stats;
		this.profiles = profiles;
	}

	@GetMapping
	@Operation(operationId = "getStats", summary = "업무 통계 (P4-02, STAT-01 — SCR-STAT-01 ②③④)",
			description = """
					화면이 차트를 직접 그리므로 숫자만 준다. 기간 [from, to] 양끝 포함, 최대 400일. 날짜는 사용자의 현재 시간대 기준.
					- 완료 업무: 보관하지 않은 업무 중 완료 시각(completedAt)의 날짜가 기간 안인 것. 지금 DONE이 아니면(완료 취소) 세지 않는다.
					- 기록: 보관하지 않은 확정(CONFIRMED) 기록, workDate 기준(확인 대기 제외).
					- 확정 일지: 상태 CONFIRMED이고 기간 시작일이 [from, to] 안인 일지(일간·주간·월간 합).
					- daily: from부터 to까지 하루도 빠짐없이(0 포함) 날짜순. 주·월 막대는 화면이 프로필 주 시작 요일로 묶는다.
					- projects: 프로젝트별 완료 업무 수·기록 수. 프로젝트는 업무의 지금 프로젝트, 업무 없는 기록·프로젝트 없는 업무는 projectId=null 한 줄.
					  둘 다 0인 프로젝트는 넣지 않는다. 정렬: completedTaskCount 내림차순 → recordCount 내림차순 → projectId.
					  소요시간 비중(⑤)은 GET /records/time-summary를 같은 기간으로 부른다.
					- firstRecordDate: 이 사용자의 첫 확정 기록 workDate(기간과 무관, 없으면 null). "1주일 기록이 쌓이면" 판단은 화면이 한다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "통계")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	StatsView get(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(required = true) LocalDate from,
			@Parameter(required = true, description = "from 이후(같아도 됨), from + 400일 이내")
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
		var s = stats.stats(user.id(), profile(user, jwt).timezone(), from, to);
		return new StatsView(s.from(), s.to(), s.completedTaskCount(), s.recordCount(), s.confirmedLogCount(),
				s.daily().stream().map(DayView::of).toList(), s.projects().stream().map(ProjectView::of).toList(),
				s.firstRecordDate());
	}

	@GetMapping("/plan-vs-actual")
	@Operation(operationId = "getPlanVsActual", summary = "예상 대비 실제 회고 (P4-02, UX-05 — SCR-STAT-01 ⑥)",
			description = """
					업무 단위로 비교한다(계획 시간 정의는 카드 0401).
					- 예상(plannedMin): 업무에 연결된 시간 일정(allDay=false) 회차 중 취소하지 않은 것의 길이(분). 회차가 속한 주는 회차 시작 시각을 사용자 시간대 날짜로 바꿔 정한다.
					  종일 일정·업무 없는 일정은 예상에 넣지 않는다.
					- 실제(actualMin): 보관하지 않은 확정 기록의 durationMin(시간 없는 기록 제외), workDate 기준. 기록의 업무로 묶는다(계획에서 온 기록인지와 무관).
					- 주: 프로필 주 시작 요일 기준. 기간 [from, to](최대 400일)와 겹치는 주를 모두 주되, 각 주는 기간 안 날짜만 센다.
					- weeks[]: 주마다 plannedMin(그 주 예상 합), actualMin(그 주 예상이 있는 업무의 실제 합), unplannedMin(그 주 예상이 없는 업무·업무 없는 기록의 실제 합).
					- topDiffs: 기간 전체에서 예상이 있는 업무를 |actualMin − plannedMin| 내림차순 → taskId로 최대 5개. actualMin은 그 업무의 기간 전체 실제.
					  업무 제목은 지금 제목(보관 업무 포함).
					시간 기록 옵션과 관계없이 응답한다(꺼져 있으면 화면이 영역을 숨긴다).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "주별 비교와 차이 큰 업무")
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	PlanVsActualView planVsActual(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @Parameter(required = true) LocalDate from,
			@Parameter(required = true, description = "from 이후(같아도 됨), from + 400일 이내")
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
		Profile p = profile(user, jwt);
		var r = stats.planVsActual(user.id(), p.timezone(), p.weekStart(), from, to);
		return new PlanVsActualView(r.from(), r.to(), r.weeks().stream().map(WeekView::of).toList(),
				r.topDiffs().stream().map(TaskDiffView::of).toList());
	}

	private Profile profile(CurrentUser user, Jwt jwt) {
		return profiles.snapshotOf(user.id(), jwt.getTokenValue()).profile();
	}

	@Schema(name = "Stats")
	record StatsView(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate from,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate to,
			@Schema(requiredMode = RequiredMode.REQUIRED) int completedTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) int recordCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) int confirmedLogCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<DayView> daily,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<ProjectView> projects,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date",
					description = "첫 확정 기록 workDate(기간과 무관), 없으면 null") LocalDate firstRecordDate) {
	}

	@Schema(name = "StatsDay")
	record DayView(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate date,
			@Schema(requiredMode = RequiredMode.REQUIRED) int completedTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) int recordCount) {
		static DayView of(Day x) {
			return new DayView(x.date(), x.completedTaskCount(), x.recordCount());
		}
	}

	@Schema(name = "StatsProject")
	record ProjectView(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED) int completedTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) int recordCount) {
		static ProjectView of(ProjectRow x) {
			return new ProjectView(x.projectId(), x.completedTaskCount(), x.recordCount());
		}
	}

	@Schema(name = "PlanVsActual")
	record PlanVsActualView(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate from,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate to,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<WeekView> weeks,
			@ArraySchema(maxItems = 5) @Schema(requiredMode = RequiredMode.REQUIRED) List<TaskDiffView> topDiffs) {
	}

	@Schema(name = "PlanVsActualWeek")
	record WeekView(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "그 주의 시작일(기간 앞으로 나갈 수 있음)") LocalDate weekStart,
			@Schema(requiredMode = RequiredMode.REQUIRED) int plannedMin,
			@Schema(requiredMode = RequiredMode.REQUIRED) int actualMin,
			@Schema(requiredMode = RequiredMode.REQUIRED) int unplannedMin) {
		static WeekView of(Week x) {
			return new WeekView(x.weekStart(), x.plannedMin(), x.actualMin(), x.unplannedMin());
		}
	}

	@Schema(name = "PlanVsActualTask")
	record TaskDiffView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED) int plannedMin,
			@Schema(requiredMode = RequiredMode.REQUIRED) int actualMin) {
		static TaskDiffView of(TaskDiff x) {
			return new TaskDiffView(x.taskId(), x.title(), x.projectId(), x.plannedMin(), x.actualMin());
		}
	}
}

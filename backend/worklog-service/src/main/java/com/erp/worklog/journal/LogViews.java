package com.erp.worklog.journal;

import com.erp.worklog.workrecord.TimeViews.TimeSummaryView;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 업무일지 API 모양 (contracts/worklog.yaml logs). LogContent·LogAchievement·LogPlan은 확정 스냅샷(work_log.content,
 * work_log_revision.content)에도 그대로 저장한다. null일 수 있는 객체 칸은 {@link LogOpenApi}가 oneOf [$ref, null]로 바꾼다.
 */
final class LogViews {

	static final String OUTCOMES = "DONE, REVIEW_REQUESTED, IN_PROGRESS";

	private LogViews() {
	}

	@Schema(name = "LogAchievement", description = "실적 한 줄 (업무·결과·진행률, SCR-LOG-02 ②)")
	record Achievement(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "줄 식별자. 새 줄은 화면이 만든다(아무 UUID)") UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 500) String text,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, maxLength = 200) String result,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" },
					allowableValues = { "DONE", "REVIEW_REQUESTED", "IN_PROGRESS" }) String outcome,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "integer", "null" }, minimum = "0", maximum = "100",
					multipleOf = 10) Integer progress,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" },
					description = "연결 업무의 프로젝트 이름(서식 실적 \"프로젝트\" 열). 서버가 taskId로 채우고 확정본은 그때 이름으로 고정") String projectName,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "이 줄의 원본 기록이 있는 날(오름차순). 주간 서식 \"한 날\", 월간 서식 \"기록 일수\"(길이). 일간은 그날 하나. recordIds가 있으면 서버가 계산한다"))
			List<LocalDate> dates,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "원본 기록 링크 (주간·월간은 묶인 기록 전부)")) List<UUID> recordIds,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "integer", "null" },
					description = "서버가 recordIds로 계산해 넣는다(PATCH로 보낸 값은 무시). 옵션 꺼짐이면 null") Integer durationMin,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "RECORD", "TASK", "MANUAL" },
					description = "RECORD 기록에서 / TASK 기록 없이 완료한 업무 / MANUAL 직접 쓴 줄") String source) {
	}

	@Schema(name = "LogPlan", description = """
			계획 한 줄. dueDate·scheduledAt은 서버가 taskId로 채운다(PATCH로 보낸 값은 무시, 확정본은 그때 값으로 고정) — 서식 "예정" 칸""")
	record Plan(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 200) String text,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date",
					description = "연결 업무의 마감일") LocalDate dueDate,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date-time",
					description = "계획 기간(planPeriod) 안에서 연결 업무의 가장 이른 시간 일정 회차 시작(취소 제외). 없으면 null") Instant scheduledAt) {
	}

	@Schema(name = "LogAuthor", description = "초안은 지금 프로필, 확정본은 확정 때 프로필. 빈 값은 null(문서에 빈칸)")
	record Author(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }) String name,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }) String organization,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }) String position) {
	}

	@Schema(name = "LogMetrics", description = "진행 현황 자동 수치 (LOG-15). 초안은 늘 원본으로 계산")
	record Metrics(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "확정 기록 수") int recordCount,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "기간 안에 완료한 업무 수") int completedTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "결과 칩 \"완료\" 기록 수") int done,
			@Schema(requiredMode = RequiredMode.REQUIRED) int reviewRequested,
			@Schema(requiredMode = RequiredMode.REQUIRED) int inProgress,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "확인 대기 기록 수 (실적에서 뺀 개수)") int pendingCount,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "integer", "null" },
					description = "시간 기록 옵션 켜짐일 때 확정 소요시간 합, 꺼져 있으면 null") Integer totalMin) {
	}

	@Schema(name = "LogPlanPeriod", description = "계획 기간 (일간이면 다음 근무일 하루, 다음 주면 그 주)")
	record Period(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate start,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate end) {
	}

	@Schema(name = "LogDay")
	record Day(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate date,
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean workday,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }) String holiday,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "CONFIRMED_LOG", "RECORDS", "NONE" },
					description = "CONFIRMED_LOG 확정 일간 일지 / RECORDS 원본 기록(미확정 일) / NONE 원본 없음") String source) {
	}

	@Schema(name = "LogProjectStat")
	record ProjectStat(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid",
					description = "프로젝트 없는 업무·업무 없는 기록은 null 한 줄") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }) String name,
			@Schema(requiredMode = RequiredMode.REQUIRED) int completedTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) int recordCount,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "integer", "null" }, description = "시간 기록 옵션 켜짐일 때만") Integer minutes) {
	}

	@Schema(name = "LogContent", description = "일지 문서 내용. 확정 스냅샷과 내보내기 파일이 이 모양을 그대로 쓴다.")
	record Content(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "업무일지 / 주간 업무일지 / 월간 업무일지") String title,
			@Schema(requiredMode = RequiredMode.REQUIRED) Author author,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					description = "true면 실적을 원본에서 만들고 있다(아직 직접 고치지 않음). 확정본은 false") boolean achievementsAuto,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<Achievement> achievements,
			@Schema(requiredMode = RequiredMode.REQUIRED) Metrics metrics,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "다음 근무일 계획 / 다음 주 계획 / 다음 달 계획") String planTitle,
			@Schema(requiredMode = RequiredMode.REQUIRED) Period planPeriod,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<Plan> plans,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, maxLength = 2000) String issues,
			@Schema(description = "시간 기록 옵션 켜짐일 때 소요시간 표 (TimeSummary와 같은 모양), 꺼져 있으면 null") TimeSummaryView time,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "WEEKLY·MONTHLY만 (DAILY는 빈 배열). 날마다 출처 — 미확정 일 표시 (LOG-07, LOG-16)")) List<Day> days,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "WEEKLY·MONTHLY만. 프로젝트별 실적 (LOG-08)")) List<ProjectStat> projects) {

		Content asConfirmed() {
			return new Content(title, author, false, achievements, metrics, planTitle, planPeriod, plans, issues, time, days,
					projects);
		}
	}

	@Schema(name = "PlanCandidate")
	record Candidate(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" }) String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date") LocalDate dueDate,
			@Schema(requiredMode = RequiredMode.REQUIRED) int progress,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "OVERDUE", "DUE", "IN_PROGRESS" },
					description = "OVERDUE 마감 지남 / DUE 계획 기간 안 마감 / IN_PROGRESS 진행 중") String reason) {
	}

	@Schema(name = "WorkLog", description = "일지 (SCR-LOG-02). id=null이면 저장하지 않은 미리보기다.")
	record WorkLogView(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "DAILY", "WEEKLY", "MONTHLY" }) String type,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate periodStart,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "양끝 포함") LocalDate periodEnd,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "NO_RECORDS", "NOT_WRITTEN", "DRAFT", "CONFIRMED" },
					description = "NO_RECORDS 기록 없음 / NOT_WRITTEN 미작성 / DRAFT 초안 / CONFIRMED 확정 (LOG-09)") String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "미리보기는 0") long version,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date-time") Instant confirmedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					description = "확정 뒤 그 기간 원본(기록·업무)이 바뀌었으면 true — \"원본이 바뀌었어요(확정 일지는 그대로)\" 안내. 확정이 아니면 false") boolean sourceChangedAfterConfirm,
			@Schema(requiredMode = RequiredMode.REQUIRED) Content content,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "계획 후보 칩 (LOG-03). 확정이면 빈 배열")) List<Candidate> planCandidates) {
	}

	@Schema(name = "VersionOnly")
	record VersionOnly(@Schema(requiredMode = RequiredMode.REQUIRED) @NotNull(message = "REQUIRED") Long version) {
	}

	@Schema(name = "LogRevision")
	record Revision(
			@Schema(requiredMode = RequiredMode.REQUIRED) int revisionNo,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant confirmedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date-time",
					description = "이 확정본을 해제한 시각. 지금 확정 상태면 null") Instant unconfirmedAt) {
	}

	@Schema(name = "LogRevisionList")
	record RevisionList(@Schema(requiredMode = RequiredMode.REQUIRED, description = "최근 것부터") List<Revision> items) {
	}

	@Schema(name = "LogRevisionDetail")
	record RevisionDetail(@JsonUnwrapped Revision revision,
			@Schema(requiredMode = RequiredMode.REQUIRED) Content content) {
	}

	/**
	 * PATCH 본문. 보낸 칸만 바꾼다. achievements·plans는 배열이라 null이면 보내지 않은 것, issues는 null로 비울 수 있어
	 * setter가 불렸는지를 따로 기록한다.
	 */
	@Schema(name = "WorkLogPatch", description = """
			보낸 칸만 바꾼다. achievements를 보내면 실적이 자동 상태에서 벗어나 보낸 목록이 그대로 저장된다.
			서버가 채우는 칸(LogAchievement.projectName·durationMin, recordIds가 있을 때 dates, LogPlan.dueDate·scheduledAt)은 보낸 값을 무시한다.""")
	static class Patch {

		@Schema(requiredMode = RequiredMode.REQUIRED)
		@NotNull(message = "REQUIRED")
		private Long version;
		@ArraySchema(maxItems = 200)
		@Size(max = 200, message = "OUT_OF_RANGE")
		private List<Achievement> achievements;
		@ArraySchema(maxItems = 50)
		@Size(max = 50, message = "OUT_OF_RANGE")
		private List<Plan> plans;
		@Schema(types = { "string", "null" }, maxLength = 2000)
		@Size(max = 2000, message = "TOO_LONG")
		private String issues;
		private boolean issuesSent;

		public Long getVersion() {
			return version;
		}

		public void setVersion(Long version) {
			this.version = version;
		}

		public List<Achievement> getAchievements() {
			return achievements;
		}

		public void setAchievements(List<Achievement> achievements) {
			this.achievements = achievements;
		}

		public List<Plan> getPlans() {
			return plans;
		}

		public void setPlans(List<Plan> plans) {
			this.plans = plans;
		}

		public String getIssues() {
			return issues;
		}

		@JsonSetter
		public void setIssues(String issues) {
			this.issues = issues;
			this.issuesSent = true;
		}

		boolean issuesSent() {
			return issuesSent;
		}
	}
}

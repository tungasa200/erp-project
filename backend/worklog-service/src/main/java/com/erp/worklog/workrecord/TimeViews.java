package com.erp.worklog.workrecord;

import com.erp.worklog.schedule.EndedOccurrences.Ended;
import com.erp.worklog.task.FrequentTaskQueries.FrequentTask;
import com.erp.worklog.workrecord.WorkRecordController.WorkRecordView;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 타이머·집계·빈 시간 응답 (P2-06·07). null일 수 있는 객체 칸은 {@link TimeOpenApi}가 oneOf [$ref, null]로 바꾼다. */
public final class TimeViews {

	private TimeViews() {
	}

	@Schema(name = "PlanBlock", description = "계획 회차 하나 (이어달리기 제안). 시간 일정만.")
	record PlanBlockView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID scheduleId,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "회차 키 (D-71). /timer/start에 그대로 보낸다") Instant occurrenceStart,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant startAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant endAt) {

		static PlanBlockView of(Ended e) {
			return e == null ? null : new PlanBlockView(e.scheduleId(), e.key(), e.title(), e.taskId(), e.startAt(), e.endAt());
		}
	}

	@Schema(name = "TimerStart", description = """
			taskId·content·회차 키 중 하나 이상(content REQUIRED). scheduleId와 occurrenceStart는 함께 보낸다(빠진 쪽 INVALID_FORMAT).
			taskId는 보관하지 않은 내 업무(NOT_FOUND). content는 앞뒤 공백을 뺀다. taskId만 보내면 content는 업무 제목.""")
	record TimerStartRequest(
			@Schema(types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(types = { "string", "null" }, maxLength = 500) @Size(max = 500, message = "TOO_LONG") String content,
			@Schema(types = { "string", "null" }, format = "uuid") UUID scheduleId,
			@Schema(types = { "string", "null" }, format = "date-time") Instant occurrenceStart) {
	}

	@Schema(name = "TimerState")
	record TimerStateView(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "실행 중인 타이머. null이면 없음") WorkRecordView running) {
	}

	@Schema(name = "TimerStopped")
	record TimerStoppedView(
			@Schema(requiredMode = RequiredMode.REQUIRED) WorkRecordView record,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					description = "1분 미만이라 버렸다. 직접 시작한 기록은 지웠고(record는 마지막 값), 회차를 가져간 기록은 확인 대기로 되돌렸다") boolean discarded,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "24시간을 넘어 startAt+24시간으로 멈췄다") boolean capped) {

		static TimerStoppedView of(TimerService.Stopped s) {
			return s == null ? null : new TimerStoppedView(WorkRecordView.of(s.record()), s.discarded(), s.capped());
		}
	}

	@Schema(name = "TimerStartResult")
	record TimerStartResult(
			@Schema(requiredMode = RequiredMode.REQUIRED) WorkRecordView running,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "자동 정지한 앞 타이머. 없으면 null") TimerStoppedView stopped) {
	}

	@Schema(name = "TimerStopResult")
	record TimerStopResult(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "실행 중인 타이머가 없었으면 null") TimerStoppedView stopped,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "이어달리기 제안. 없으면 null") PlanBlockView next) {
	}

	@Schema(name = "TimeSummaryProject")
	public record ProjectMinutes(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid",
					description = "null = 업무 없는 기록·프로젝트 없는 업무") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED) int minutes) {
	}

	@Schema(name = "TimeSummaryTask")
	public record TaskMinutes(
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid",
					description = "null = 업무 없는 기록") UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" },
					description = "업무의 지금 제목, 업무 없는 기록은 null") String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid",
					description = "업무의 지금 프로젝트") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED) int minutes) {
	}

	@Schema(name = "TimeSummary", description = "정렬: minutes 내림차순 → id(null은 뒤)")
	public record TimeSummaryView(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate from,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate to,
			@Schema(requiredMode = RequiredMode.REQUIRED) int totalMin,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "더한 기록 수") int recordCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<ProjectMinutes> projects,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<TaskMinutes> tasks) {

		public static TimeSummaryView of(TimeQueries.Summary s) {
			return new TimeSummaryView(s.from(), s.to(), s.totalMin(), s.recordCount(),
					s.projects().stream().map(p -> new ProjectMinutes(p.id(), p.minutes())).toList(),
					s.tasks().stream().map(t -> new TaskMinutes(t.id(), t.title(), t.projectId(), t.minutes())).toList());
		}
	}

	@Schema(name = "TimeGapPrevious", description = "직전 업무 이어서: 구간 시작 이전에 끝난 가장 가까운 같은 날 시간 기록")
	record GapPrevious(
			@Schema(requiredMode = RequiredMode.REQUIRED) String content,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID taskId) {
	}

	@Schema(name = "TimeGapPlan", description = """
			이 시간 계획: 구간과 가장 많이 겹치는 시간 일정 회차(이미 처리한 회차 제외). pendingRecordId가 있으면 새로 만들지 말고
			그 기록을 PATCH(startAt·endAt·status=CONFIRMED)한다(같은 계획이 두 번 세어지지 않게).""")
	record GapPlan(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID scheduleId,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant occurrenceStart,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant startAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant endAt,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID pendingRecordId) {
	}

	@Schema(name = "TimeGap")
	record TimeGapView(
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant startAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant endAt,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "15") int minutes,
			@Schema(requiredMode = RequiredMode.REQUIRED) GapPrevious previous,
			@Schema(requiredMode = RequiredMode.REQUIRED) GapPlan plan,
			// FrequentTask 스키마는 TaskController가 이름을 정한다. 여기서는 숨기고 TimeOpenApi가 $ref로 붙인다
			@Schema(hidden = true) FrequentTask frequent) {

		static TimeGapView of(TimeQueries.Gap g) {
			GapPrevious previous = g.previous() == null ? null : new GapPrevious(g.previous().content(), g.previous().taskId());
			GapPlan plan = null;
			if (g.plan() != null) {
				Ended e = g.plan().block();
				plan = new GapPlan(e.scheduleId(), e.key(), e.title(), e.taskId(), e.startAt(), e.endAt(),
						g.plan().pendingRecordId());
			}
			return new TimeGapView(g.startAt(), g.endAt(), g.minutes(), previous, plan, g.frequent());
		}
	}

	@Schema(name = "TimeGapList")
	record TimeGapList(@Schema(requiredMode = RequiredMode.REQUIRED, description = "시간순") List<TimeGapView> items) {
	}
}

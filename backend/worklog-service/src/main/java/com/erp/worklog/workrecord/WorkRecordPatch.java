package com.erp.worklog.workrecord;

import com.fasterxml.jackson.annotation.JsonSetter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/**
 * PATCH /api/worklog/records/{id} 본문. nullable 칸은 null을 보내면 비우고 보내지 않으면 그대로 두므로,
 * setter가 불렸는지(칸이 본문에 있었는지)를 따로 기록한다. status·content·workDate는 null이면 보내지 않은 것으로 본다.
 */
@Schema(name = "WorkRecordPatch",
		description = "보낸 칸만 바꾼다. 검증 규칙은 WorkRecordCreate와 같다(바꾼 뒤의 전체 값으로 검사). scheduleId·occurrenceStart는 바꿀 수 없다.")
class WorkRecordPatch {

	@Schema(requiredMode = RequiredMode.REQUIRED)
	@NotNull(message = "REQUIRED")
	private Long version;
	@Schema(allowableValues = { "PENDING", "CONFIRMED", "DISMISSED" })
	@Pattern(regexp = WorkRecordController.STATUS, message = "INVALID_FORMAT")
	private String status;
	@Schema(minLength = 1, maxLength = 500)
	@Size(max = 500, message = "TOO_LONG")
	private String content;
	@Schema(format = "date", description = "startAt이 있으면 무시한다(startAt으로 계산)")
	private LocalDate workDate;
	@Schema(types = { "string", "null" }, format = "uuid")
	private UUID taskId;
	private boolean taskIdSent;
	@Schema(types = { "string", "null" }, maxLength = 200)
	@Size(max = 200, message = "TOO_LONG")
	private String result;
	private boolean resultSent;
	@Schema(types = { "string", "null" }, allowableValues = { "DONE", "REVIEW_REQUESTED", "IN_PROGRESS" })
	@Pattern(regexp = WorkRecordController.OUTCOME, message = "INVALID_FORMAT")
	private String outcome;
	private boolean outcomeSent;
	@Schema(types = { "integer", "null" }, minimum = "0", maximum = "100", multipleOf = 10)
	private Integer progress;
	private boolean progressSent;
	@Schema(types = { "string", "null" }, format = "date-time")
	private Instant startAt;
	private boolean startAtSent;
	@Schema(types = { "string", "null" }, format = "date-time")
	private Instant endAt;
	private boolean endAtSent;
	@Schema(types = { "integer", "null" }, minimum = "1", maximum = "1440")
	private Integer durationMin;
	private boolean durationMinSent;

	public Long getVersion() {
		return version;
	}

	public void setVersion(Long version) {
		this.version = version;
	}

	public String getStatus() {
		return status;
	}

	public void setStatus(String status) {
		this.status = status;
	}

	public String getContent() {
		return content;
	}

	public void setContent(String content) {
		this.content = content;
	}

	public LocalDate getWorkDate() {
		return workDate;
	}

	public void setWorkDate(LocalDate workDate) {
		this.workDate = workDate;
	}

	public UUID getTaskId() {
		return taskId;
	}

	@JsonSetter
	public void setTaskId(UUID taskId) {
		this.taskId = taskId;
		this.taskIdSent = true;
	}

	public String getResult() {
		return result;
	}

	@JsonSetter
	public void setResult(String result) {
		this.result = result;
		this.resultSent = true;
	}

	public String getOutcome() {
		return outcome;
	}

	@JsonSetter
	public void setOutcome(String outcome) {
		this.outcome = outcome;
		this.outcomeSent = true;
	}

	public Integer getProgress() {
		return progress;
	}

	@JsonSetter
	public void setProgress(Integer progress) {
		this.progress = progress;
		this.progressSent = true;
	}

	public Instant getStartAt() {
		return startAt;
	}

	@JsonSetter
	public void setStartAt(Instant startAt) {
		this.startAt = startAt;
		this.startAtSent = true;
	}

	public Instant getEndAt() {
		return endAt;
	}

	@JsonSetter
	public void setEndAt(Instant endAt) {
		this.endAt = endAt;
		this.endAtSent = true;
	}

	public Integer getDurationMin() {
		return durationMin;
	}

	@JsonSetter
	public void setDurationMin(Integer durationMin) {
		this.durationMin = durationMin;
		this.durationMinSent = true;
	}

	WorkRecordService.Change toChange() {
		return new WorkRecordService.Change(version, status, content, workDate, sent(taskIdSent, taskId),
				sent(resultSent, result), sent(outcomeSent, outcome), sent(progressSent, progress),
				sent(startAtSent, startAt), sent(endAtSent, endAt), sent(durationMinSent, durationMin));
	}

	/** 보내지 않았으면 null, null을 보냈으면 Optional.empty() */
	private static <T> Optional<T> sent(boolean sent, T value) {
		return sent ? Optional.ofNullable(value) : null;
	}
}

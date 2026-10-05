package com.erp.worklog.schedule;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;

/**
 * PATCH /api/worklog/schedules/{id} 본문 ("모든 일정"). null을 보내 비울 수 있는 칸은 setter가 불렸는지(본문에 있었는지)를 따로 기록한다.
 * title·allDay는 null이면 보내지 않은 것으로 본다. 검증은 바꾼 뒤의 전체 값으로 ScheduleService가 한다.
 */
@Schema(name = "SchedulePatch", description = "보낸 칸만 바꾼다. 검증 규칙은 ScheduleCreate와 같다(바꾼 뒤의 전체 값으로 검사).")
class SchedulePatch {

	@Schema(requiredMode = RequiredMode.REQUIRED)
	@NotNull(message = "REQUIRED")
	private Long version;

	@Schema(minLength = 1, maxLength = 200)
	@Size(max = 200, message = "TOO_LONG")
	private String title;

	private Boolean allDay;

	@Schema(types = { "string", "null" }, format = "date-time")
	private Instant startAt;

	private boolean startAtSent;

	@Schema(types = { "string", "null" }, format = "date-time")
	private Instant endAt;

	private boolean endAtSent;

	@Schema(types = { "string", "null" }, format = "date")
	private LocalDate startDate;

	private boolean startDateSent;

	@Schema(types = { "string", "null" }, format = "date")
	private LocalDate endDate;

	private boolean endDateSent;

	@Schema(types = { "object", "null" })
	@Valid
	private ScheduleDtos.RecurrenceDto recurrence;

	private boolean recurrenceSent;

	@Schema(types = { "string", "null" }, format = "uuid")
	private UUID taskId;

	private boolean taskIdSent;

	@Schema(types = { "string", "null" }, maxLength = 5000)
	@Size(max = 5000, message = "TOO_LONG")
	private String memo;

	private boolean memoSent;

	public Long getVersion() {
		return version;
	}

	public void setVersion(Long version) {
		this.version = version;
	}

	public String getTitle() {
		return title;
	}

	public void setTitle(String title) {
		this.title = title;
	}

	public Boolean getAllDay() {
		return allDay;
	}

	public void setAllDay(Boolean allDay) {
		this.allDay = allDay;
	}

	public Instant getStartAt() {
		return startAt;
	}

	public void setStartAt(Instant startAt) {
		this.startAt = startAt;
		this.startAtSent = true;
	}

	public Instant getEndAt() {
		return endAt;
	}

	public void setEndAt(Instant endAt) {
		this.endAt = endAt;
		this.endAtSent = true;
	}

	public LocalDate getStartDate() {
		return startDate;
	}

	public void setStartDate(LocalDate startDate) {
		this.startDate = startDate;
		this.startDateSent = true;
	}

	public LocalDate getEndDate() {
		return endDate;
	}

	public void setEndDate(LocalDate endDate) {
		this.endDate = endDate;
		this.endDateSent = true;
	}

	public ScheduleDtos.RecurrenceDto getRecurrence() {
		return recurrence;
	}

	public void setRecurrence(ScheduleDtos.RecurrenceDto recurrence) {
		this.recurrence = recurrence;
		this.recurrenceSent = true;
	}

	public UUID getTaskId() {
		return taskId;
	}

	public void setTaskId(UUID taskId) {
		this.taskId = taskId;
		this.taskIdSent = true;
	}

	public String getMemo() {
		return memo;
	}

	public void setMemo(String memo) {
		this.memo = memo;
		this.memoSent = true;
	}

	boolean startAtSent() {
		return startAtSent;
	}

	boolean endAtSent() {
		return endAtSent;
	}

	boolean startDateSent() {
		return startDateSent;
	}

	boolean endDateSent() {
		return endDateSent;
	}

	boolean recurrenceSent() {
		return recurrenceSent;
	}

	boolean taskIdSent() {
		return taskIdSent;
	}

	boolean memoSent() {
		return memoSent;
	}

}

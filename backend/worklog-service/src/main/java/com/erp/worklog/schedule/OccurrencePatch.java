package com.erp.worklog.schedule;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;

/**
 * PATCH /api/worklog/schedules/{id}/occurrences/{occurrenceStart} 본문 ("이 일정만"). memo만 null로 비울 수 있어 보냈는지를 기록한다.
 */
@Schema(name = "OccurrencePatch", description = "보낸 칸만 바꾼다. memo에 null을 보내면 이 회차의 메모만 비운다.")
class OccurrencePatch {

	@Schema(requiredMode = RequiredMode.REQUIRED, description = "일정(Schedule)의 version")
	@NotNull(message = "REQUIRED")
	private Long version;

	@Schema(minLength = 1, maxLength = 200)
	@Size(max = 200, message = "TOO_LONG")
	private String title;

	@Schema(format = "date-time")
	private Instant startAt;

	@Schema(format = "date-time")
	private Instant endAt;

	@Schema(format = "date")
	private LocalDate startDate;

	@Schema(format = "date")
	private LocalDate endDate;

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

	public Instant getStartAt() {
		return startAt;
	}

	public void setStartAt(Instant startAt) {
		this.startAt = startAt;
	}

	public Instant getEndAt() {
		return endAt;
	}

	public void setEndAt(Instant endAt) {
		this.endAt = endAt;
	}

	public LocalDate getStartDate() {
		return startDate;
	}

	public void setStartDate(LocalDate startDate) {
		this.startDate = startDate;
	}

	public LocalDate getEndDate() {
		return endDate;
	}

	public void setEndDate(LocalDate endDate) {
		this.endDate = endDate;
	}

	public String getMemo() {
		return memo;
	}

	public void setMemo(String memo) {
		this.memo = memo;
		this.memoSent = true;
	}

	boolean memoSent() {
		return memoSent;
	}

}

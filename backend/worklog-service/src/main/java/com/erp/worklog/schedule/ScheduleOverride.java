package com.erp.worklog.schedule;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.persistence.Embeddable;

/**
 * 반복 일정 한 회차의 변경 ("이 일정만", schedule_exception 행). null인 칸은 일정 값을 따른다.
 * 시각은 바꿀 때 시작·끝을 함께 저장한다. memo는 memoOverridden이 true일 때만 회차 값(null이면 비움)이다.
 */
@Embeddable
class ScheduleOverride {

	private boolean cancelled;

	private String title;

	private Instant startAt;

	private Instant endAt;

	private LocalDate startDate;

	private LocalDate endDate;

	private String memo;

	private boolean memoOverridden;

	protected ScheduleOverride() {
	}

	static ScheduleOverride cancelledOccurrence() {
		ScheduleOverride o = new ScheduleOverride();
		o.cancelled = true;
		return o;
	}

	static ScheduleOverride empty() {
		return new ScheduleOverride();
	}

	/** Hibernate는 값이 같은 새 객체로 바꾸면 변경으로 보지 않으므로, 바꿀 때는 항상 사본을 만든다. */
	ScheduleOverride copy() {
		ScheduleOverride o = new ScheduleOverride();
		o.cancelled = cancelled;
		o.title = title;
		o.startAt = startAt;
		o.endAt = endAt;
		o.startDate = startDate;
		o.endDate = endDate;
		o.memo = memo;
		o.memoOverridden = memoOverridden;
		return o;
	}

	ScheduleOverride withTitle(String title) {
		ScheduleOverride o = copy();
		o.title = title;
		return o;
	}

	ScheduleOverride withTimes(Instant startAt, Instant endAt) {
		ScheduleOverride o = copy();
		o.startAt = startAt;
		o.endAt = endAt;
		return o;
	}

	ScheduleOverride withDates(LocalDate startDate, LocalDate endDate) {
		ScheduleOverride o = copy();
		o.startDate = startDate;
		o.endDate = endDate;
		return o;
	}

	ScheduleOverride withMemo(String memo) {
		ScheduleOverride o = copy();
		o.memo = memo;
		o.memoOverridden = true;
		return o;
	}

	boolean cancelled() {
		return cancelled;
	}

	String title() {
		return title;
	}

	Instant startAt() {
		return startAt;
	}

	Instant endAt() {
		return endAt;
	}

	LocalDate startDate() {
		return startDate;
	}

	LocalDate endDate() {
		return endDate;
	}

	String memo() {
		return memo;
	}

	boolean memoOverridden() {
		return memoOverridden;
	}

}

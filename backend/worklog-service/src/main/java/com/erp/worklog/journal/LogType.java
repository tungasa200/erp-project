package com.erp.worklog.journal;

import com.erp.worklog.error.Errors;

import java.time.LocalDate;
import java.util.Locale;

/** 일지 종류와 기간. 일간은 그날, 주간은 주 시작 요일부터 7일, 월간은 그달. */
enum LogType {

	DAILY("업무일지(일간)"), WEEKLY("업무일지(주간)"), MONTHLY("업무일지(월간)");

	final String title;

	LogType(String title) {
		this.title = title;
	}

	/** 경로의 소문자 종류 (daily·weekly·monthly). */
	static LogType ofPath(String value) {
		try {
			LogType type = valueOf(value.toUpperCase(Locale.ROOT));
			if (value.equals(type.name().toLowerCase(Locale.ROOT))) {
				return type;
			}
		} catch (IllegalArgumentException e) {
			// 아래에서 400
		}
		throw Errors.invalid("type", "INVALID_FORMAT", null);
	}

	LocalDate end(LocalDate start) {
		return switch (this) {
			case DAILY -> start;
			case WEEKLY -> start.plusDays(6);
			case MONTHLY -> start.withDayOfMonth(start.lengthOfMonth());
		};
	}

	/** date가 들어 있는 기간의 시작일. */
	LocalDate startOf(LocalDate date, WorkCalendar calendar) {
		return switch (this) {
			case DAILY -> date;
			case WEEKLY -> calendar.weekStartOf(date);
			case MONTHLY -> date.withDayOfMonth(1);
		};
	}

	/** 기간 시작일이 맞지 않으면 400 (periodStart, INVALID_FORMAT). */
	void checkStart(LocalDate start, WorkCalendar calendar) {
		if (!startOf(start, calendar).equals(start)) {
			throw Errors.invalid("periodStart", "INVALID_FORMAT", null);
		}
	}
}

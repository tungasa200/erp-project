package com.erp.worklog.journal;

import com.erp.worklog.user.Profile;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;

/** 사용자 한 명의 근무일 (D-37): 업무 요일(work_days 비트, 월=1 … 일=64) 중 공휴일이 아닌 날. 주 시작 요일은 프로필 week_start. */
record WorkCalendar(int workDays, DayOfWeek weekStart, Holidays holidays) {

	/** 근무일이 하나도 없는 설정이어도 끝나도록 이 만큼만 찾는다. */
	private static final int SEARCH_DAYS = 400;

	static WorkCalendar of(Profile p, Holidays holidays) {
		DayOfWeek weekStart = p.weekStart() == null ? DayOfWeek.MONDAY : DayOfWeek.valueOf(p.weekStart());
		return new WorkCalendar(p.workDays(), weekStart, holidays);
	}

	boolean workday(LocalDate date) {
		return (workDays & (1 << (date.getDayOfWeek().getValue() - 1))) != 0 && holidays.name(date) == null;
	}

	String holiday(LocalDate date) {
		return holidays.name(date);
	}

	LocalDate weekStartOf(LocalDate date) {
		return date.with(TemporalAdjusters.previousOrSame(weekStart));
	}

	/** date 다음 날부터 찾은 첫 근무일. 없으면 다음 날. */
	LocalDate nextWorkday(LocalDate date) {
		for (int i = 1; i <= SEARCH_DAYS; i++) {
			LocalDate d = date.plusDays(i);
			if (workday(d)) {
				return d;
			}
		}
		return date.plusDays(1);
	}

	/** [from, to] 안의 마지막 근무일, 없으면 null. */
	LocalDate lastWorkday(LocalDate from, LocalDate to) {
		for (LocalDate d = to; !d.isBefore(from); d = d.minusDays(1)) {
			if (workday(d)) {
				return d;
			}
		}
		return null;
	}
}

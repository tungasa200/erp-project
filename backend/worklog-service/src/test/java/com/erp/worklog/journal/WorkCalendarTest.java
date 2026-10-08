package com.erp.worklog.journal;

import com.erp.worklog.journal.LogViews.Period;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.json.JsonMapper;

import java.time.DayOfWeek;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 근무일(D-37)·계획 기간(LOG-14)·기간 시작일 규칙. DB 없이 돈다. 공휴일은 빌드가 넣은 holidays/KR.json(2026-10-09 한글날). */
class WorkCalendarTest {

	static final Holidays HOLIDAYS = holidays();
	/** 월~금(31), 월요일 시작. */
	static final WorkCalendar WEEKDAYS = new WorkCalendar(31, DayOfWeek.MONDAY, HOLIDAYS);

	@Test
	void 공휴일과_업무_요일이_아닌_날은_근무일이_아니다() {
		assertThat(WEEKDAYS.workday(LocalDate.parse("2026-10-08"))).isTrue();
		assertThat(WEEKDAYS.workday(LocalDate.parse("2026-10-09"))).isFalse(); // 한글날(금)
		assertThat(WEEKDAYS.holiday(LocalDate.parse("2026-10-09"))).isEqualTo("한글날");
		assertThat(WEEKDAYS.workday(LocalDate.parse("2026-10-10"))).isFalse(); // 토
	}

	@Test
	void 일간_계획은_다음_근무일_하루이고_다음_근무일이_다음_주면_그_주다() {
		Period tue = LogBuilder.planPeriod(WEEKDAYS, LogType.DAILY, LocalDate.parse("2026-10-06"));
		assertThat(tue).isEqualTo(new Period(LocalDate.parse("2026-10-07"), LocalDate.parse("2026-10-07")));
		assertThat(LogBuilder.planTitle(LogType.DAILY, tue)).isEqualTo("다음 근무일 계획");

		// 목요일 다음 근무일은 한글날(금)을 건너뛴 다음 주 월요일
		Period thu = LogBuilder.planPeriod(WEEKDAYS, LogType.DAILY, LocalDate.parse("2026-10-08"));
		assertThat(thu).isEqualTo(new Period(LocalDate.parse("2026-10-12"), LocalDate.parse("2026-10-18")));
		assertThat(LogBuilder.planTitle(LogType.DAILY, thu)).isEqualTo("다음 주 계획");
	}

	@Test
	void 주간_월간_계획은_다음_주_다음_달이다() {
		assertThat(LogBuilder.planPeriod(WEEKDAYS, LogType.WEEKLY, LocalDate.parse("2026-10-05")))
			.isEqualTo(new Period(LocalDate.parse("2026-10-12"), LocalDate.parse("2026-10-18")));
		assertThat(LogBuilder.planPeriod(WEEKDAYS, LogType.MONTHLY, LocalDate.parse("2026-01-01")))
			.isEqualTo(new Period(LocalDate.parse("2026-02-01"), LocalDate.parse("2026-02-28")));
	}

	@Test
	void 기간_시작일은_주_시작_요일과_1일이어야_한다() {
		WorkCalendar sundayStart = new WorkCalendar(31, DayOfWeek.SUNDAY, HOLIDAYS);
		LogType.WEEKLY.checkStart(LocalDate.parse("2026-10-04"), sundayStart);
		assertThatThrownBy(() -> LogType.WEEKLY.checkStart(LocalDate.parse("2026-10-05"), sundayStart));
		assertThatThrownBy(() -> LogType.MONTHLY.checkStart(LocalDate.parse("2026-10-02"), WEEKDAYS));
		assertThat(LogType.MONTHLY.end(LocalDate.parse("2026-02-01"))).isEqualTo(LocalDate.parse("2026-02-28"));
	}

	@Test
	void 경로_종류는_소문자만_받는다() {
		assertThat(LogType.ofPath("weekly")).isEqualTo(LogType.WEEKLY);
		assertThatThrownBy(() -> LogType.ofPath("WEEKLY"));
		assertThatThrownBy(() -> LogType.ofPath("yearly"));
	}

	@Test
	void 근무일이_없는_설정도_끝난다() {
		WorkCalendar none = new WorkCalendar(0, DayOfWeek.MONDAY, HOLIDAYS);
		assertThat(none.nextWorkday(LocalDate.parse("2026-10-08"))).isEqualTo(LocalDate.parse("2026-10-09"));
	}

	private static Holidays holidays() {
		try {
			return new Holidays(new ClassPathResource("holidays/KR.json"), JsonMapper.builder().build());
		} catch (java.io.IOException e) {
			throw new IllegalStateException(e);
		}
	}
}

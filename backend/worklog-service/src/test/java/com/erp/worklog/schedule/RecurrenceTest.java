package com.erp.worklog.schedule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.erp.worklog.schedule.Recurrence.Frequency;

class RecurrenceTest {

	@Test
	void 매일은_횟수에서_끝난다() {
		var rule = new Recurrence(Frequency.DAILY, null, null, 3);
		assertThat(take(rule, LocalDate.of(2026, 10, 30), 10)).containsExactly(LocalDate.of(2026, 10, 30),
				LocalDate.of(2026, 10, 31), LocalDate.of(2026, 11, 1));
	}

	@Test
	void 매주는_고른_요일만_순서대로() {
		// 2026-10-05는 월요일
		var rule = new Recurrence(Frequency.WEEKLY, Set.of(DayOfWeek.MONDAY, DayOfWeek.THURSDAY), null, null);
		assertThat(take(rule, LocalDate.of(2026, 10, 5), 4)).containsExactly(LocalDate.of(2026, 10, 5),
				LocalDate.of(2026, 10, 8), LocalDate.of(2026, 10, 12), LocalDate.of(2026, 10, 15));
		assertThat(rule.admitsStart(LocalDate.of(2026, 10, 5))).isTrue();
		assertThat(rule.admitsStart(LocalDate.of(2026, 10, 6))).isFalse();
	}

	@Test
	void 매월_31일은_없는_달을_건너뛰고_횟수에_넣지_않는다() {
		var rule = new Recurrence(Frequency.MONTHLY, null, null, 4);
		assertThat(take(rule, LocalDate.of(2026, 1, 31), 10)).containsExactly(LocalDate.of(2026, 1, 31),
				LocalDate.of(2026, 3, 31), LocalDate.of(2026, 5, 31), LocalDate.of(2026, 7, 31));
	}

	@Test
	void 종료_날짜는_그날을_포함한다() {
		var rule = new Recurrence(Frequency.DAILY, null, LocalDate.of(2026, 10, 7), null);
		assertThat(take(rule, LocalDate.of(2026, 10, 5), 10)).hasSize(3).last().isEqualTo(LocalDate.of(2026, 10, 7));
	}

	@Test
	void 끝_조건이_없으면_계속_이어진다() {
		var rule = new Recurrence(Frequency.MONTHLY, null, null, null);
		assertThat(take(rule, LocalDate.of(2026, 2, 28), 100)).hasSize(100);
	}

	@Test
	void RRULE로_저장하고_다시_읽는다() {
		var weekly = new Recurrence(Frequency.WEEKLY, Set.of(DayOfWeek.FRIDAY, DayOfWeek.MONDAY), LocalDate.of(2026, 12, 31),
				null);
		assertThat(weekly.toRrule()).isEqualTo("FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20261231");
		assertThat(Recurrence.parse(weekly.toRrule())).isEqualTo(weekly);

		var daily = new Recurrence(Frequency.DAILY, null, null, 5);
		assertThat(daily.toRrule()).isEqualTo("FREQ=DAILY;COUNT=5");
		assertThat(Recurrence.parse("FREQ=DAILY;COUNT=5")).isEqualTo(daily);
	}

	@Test
	void 요일_없는_매주는_만들_수_없다() {
		assertThatThrownBy(() -> new Recurrence(Frequency.WEEKLY, Set.of(), null, null))
			.isInstanceOf(IllegalArgumentException.class);
	}

	private static List<LocalDate> take(Recurrence rule, LocalDate start, int max) {
		List<LocalDate> dates = new ArrayList<>();
		Iterator<LocalDate> it = rule.dates(start);
		while (it.hasNext() && dates.size() < max) {
			dates.add(it.next());
		}
		return dates;
	}

}

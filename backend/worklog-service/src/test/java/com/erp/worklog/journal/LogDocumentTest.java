package com.erp.worklog.journal;

import com.erp.worklog.journal.LogDocument.Kind;
import com.erp.worklog.journal.LogViews.Author;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Day;
import com.erp.worklog.journal.LogViews.Metrics;
import com.erp.worklog.journal.LogViews.Period;
import com.erp.worklog.journal.LogViews.WorkLogView;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LogDocumentTest {

	@Test
	void 주간_표에서_오늘_뒤_근무일은_빈칸이다() {
		LocalDate mon = LocalDate.of(2026, 10, 5);
		List<Day> days = List.of(new Day(mon, true, null, "CONFIRMED_LOG"), new Day(mon.plusDays(1), true, null, "NONE"),
				new Day(mon.plusDays(2), true, null, "RECORDS"), new Day(mon.plusDays(3), true, null, "NONE"),
				new Day(mon.plusDays(4), true, null, "NONE"), new Day(mon.plusDays(5), false, null, "NONE"),
				new Day(mon.plusDays(6), false, null, "NONE"));
		Content c = new Content("주간 업무일지", new Author("홍길동", null, null), true, List.of(),
				new Metrics(0, 0, 0, 0, 0, 0, null), "다음 주 계획", new Period(mon.plusDays(7), mon.plusDays(13)), List.of(), null,
				null, days, List.of());
		WorkLogView log = new WorkLogView(null, "WEEKLY", mon, mon.plusDays(6), "DRAFT", 0, null, false, c, List.of());

		LogDocument d = LogDocument.of(log, ZoneId.of("Asia/Seoul"), mon.plusDays(2), Map.of());

		LogDocument.Section week = d.sections().stream().filter(s -> s.kind() == Kind.DAYS).findFirst().orElseThrow();
		assertThat(week.table().rows().get(0)).containsExactly("확정", "기록 없음", "원본 기록", "", "", "휴일", "휴일");
	}
}

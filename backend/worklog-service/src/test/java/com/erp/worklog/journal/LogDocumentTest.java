package com.erp.worklog.journal;

import com.erp.worklog.journal.LogDocument.Kind;
import com.erp.worklog.journal.LogViews.Achievement;
import com.erp.worklog.journal.LogViews.Author;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Day;
import com.erp.worklog.journal.LogViews.Metrics;
import com.erp.worklog.journal.LogViews.Period;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.workrecord.TimeViews.TaskMinutes;
import com.erp.worklog.workrecord.TimeViews.TimeSummaryView;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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

		LogDocument d = LogDocument.of(log, ZoneId.of("Asia/Seoul"), mon.plusDays(2), Map.of(), Map.of());

		LogDocument.Section week = d.sections().stream().filter(s -> s.kind() == Kind.DAYS).findFirst().orElseThrow();
		assertThat(week.table().rows().get(0)).containsExactly("확정", "기록 없음", "원본 기록", "", "", "휴일", "휴일");
	}

	@Test
	void 일간_진행_현황_괄호는_업무명과_마지막_진행률_소요시간_표_프로젝트_없음은_빈칸() {
		LocalDate day = LocalDate.of(2026, 10, 7);
		UUID task = UUID.randomUUID();
		List<Achievement> rows = List.of(
				new Achievement(UUID.randomUUID(), "설계 문서 쓰기", null, "IN_PROGRESS", 30, task, null, List.of(day), List.of(), null,
						"RECORD"),
				new Achievement(UUID.randomUUID(), "설계 검토", null, "IN_PROGRESS", 60, task, null, List.of(day), List.of(), null,
						"RECORD"),
				new Achievement(UUID.randomUUID(), "메모 정리", null, "IN_PROGRESS", null, null, null, List.of(day), List.of(), null,
						"RECORD"));
		TimeSummaryView time = new TimeSummaryView(day, day, 60, 1, List.of(),
				List.of(new TaskMinutes(UUID.randomUUID(), "프로젝트 없는 업무", null, 60)));
		Content c = new Content("업무일지", new Author("홍길동", null, null), true, rows, new Metrics(3, 0, 0, 0, 3, 0, 60),
				"다음 근무일 계획", new Period(day.plusDays(1), day.plusDays(1)), List.of(), null, time, List.of(), List.of());
		WorkLogView log = new WorkLogView(null, "DAILY", day, day, "DRAFT", 0, null, false, c, List.of());

		LogDocument d = LogDocument.of(log, ZoneId.of("Asia/Seoul"), day, Map.of(), Map.of(task, "결제 API"));

		LogDocument.Section progress = d.sections().stream().filter(s -> "진행 현황".equals(s.heading())).findFirst()
			.orElseThrow();
		assertThat(progress.line()).isEqualTo("진행 중 3건 (결제 API 60%, 메모 정리)");
		// 소요시간 표: 프로젝트 없는 업무의 프로젝트 칸은 빈칸 (화면과 같음)
		LogDocument.Section times = d.sections().stream().filter(s -> "소요시간".equals(s.heading())).findFirst().orElseThrow();
		assertThat(times.table().rows().getFirst()).containsExactly("", "프로젝트 없는 업무", "1시간", "100%");
	}
}

package com.erp.worklog.journal;

import com.erp.worklog.journal.LogViews.Achievement;
import com.erp.worklog.journal.LogViews.Author;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Day;
import com.erp.worklog.journal.LogViews.Metrics;
import com.erp.worklog.journal.LogViews.Period;
import com.erp.worklog.journal.LogViews.WorkLogView;
import org.junit.jupiter.api.Test;
import org.openpdf.text.pdf.PdfReader;
import org.openpdf.text.pdf.parser.PdfTextExtractor;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LogPdfTest {

	@Test
	void 좁은_칸에서_한글_낱말은_띄어쓰기에서만_줄을_바꾼다() throws Exception {
		LocalDate mon = LocalDate.of(2026, 10, 5);
		List<Day> days = new java.util.ArrayList<>();
		for (int i = 0; i < 7; i++) {
			days.add(new Day(mon.plusDays(i), i < 5, null, "RECORDS"));
		}
		Achievement a = new Achievement(UUID.randomUUID(), "로그인 화면 개선", "완료", "DONE", 100, UUID.randomUUID(),
				"고객관리 시스템개편", List.of(mon, mon.plusDays(1)), List.of(), null, "RECORD");
		Content c = new Content("주간 업무일지", new Author("홍길동", null, null), true, List.of(a),
				new Metrics(0, 0, 0, 0, 0, 0, null), "다음 주 계획", new Period(mon.plusDays(7), mon.plusDays(13)), List.of(), null,
				null, days, List.of());
		WorkLogView log = new WorkLogView(null, "WEEKLY", mon, mon.plusDays(6), "DRAFT", 0, null, false, c, List.of());

		byte[] pdf = LogPdf.write(LogDocument.of(log, ZoneId.of("Asia/Seoul"), mon.plusDays(6), Map.of()), "t");

		String text = new PdfTextExtractor(new PdfReader(pdf)).getTextFromPage(1);
		// 주간 표 프로젝트 칸(22mm): 기본 규칙이면 "고객관리 시 / 스템개편"으로 갈린다
		assertThat(text).contains("시스템개편");
	}
}

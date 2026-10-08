package com.erp.worklog.journal;

import com.erp.worklog.journal.LogSources.DoneTask;
import com.erp.worklog.journal.LogSources.Rec;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LogMetricsTest {

	private static final LocalDate MON = LocalDate.of(2026, 10, 5);

	private static Rec rec(UUID taskId, LocalDate day, String outcome) {
		return new Rec(UUID.randomUUID(), day, "기록", null, outcome, null, taskId, null);
	}

	private static DoneTask done(UUID id, LocalDate day) {
		return new DoneTask(id, "업무", null, day);
	}

	@Test
	void 완료에_기록_없이_완료한_업무를_더하고_그날_기록이_있는_업무는_한_번만_센다() {
		UUID withDoneRecord = UUID.randomUUID();
		UUID withoutRecord = UUID.randomUUID();
		UUID recordedOtherDay = UUID.randomUUID();
		List<Rec> records = List.of(rec(withDoneRecord, MON, "DONE"), rec(recordedOtherDay, MON, "IN_PROGRESS"),
				rec(null, MON.plusDays(1), "DONE"));
		List<DoneTask> done = List.of(done(withDoneRecord, MON), done(withoutRecord, MON.plusDays(2)),
				done(recordedOtherDay, MON.plusDays(3)));

		// 주간·월간: 완료한 날(목) 그 업무 기록이 없으면 다른 날(월) 기록이 있어도 표의 업무 제목 줄처럼 센다
		assertThat(LogBuilder.doneWithoutRecord(records, done)).isEqualTo(2);
		// 일간: 그날 '완료' 기록이 있는 업무는 더하지 않는다
		assertThat(LogBuilder.doneWithoutRecord(records.subList(0, 1), done.subList(0, 1))).isZero();
		assertThat(LogBuilder.doneWithoutRecord(List.of(), done.subList(1, 2))).isEqualTo(1);
	}
}

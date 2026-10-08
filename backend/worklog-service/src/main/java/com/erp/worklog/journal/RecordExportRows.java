package com.erp.worklog.journal;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 기간 업무 기록 Excel의 행 (EXP-03, GET /records/export와 일지 XLSX 시트 2 "기록").
 * workDate가 [from, to]인 보관하지 않은 기록(세 상태 모두), 실행 중 타이머 제외. 날짜 → 시작(없으면 뒤) → 만든 순.
 */
@Component
class RecordExportRows {

	record Line(LocalDate workDate, String content, String taskTitle, String projectName, String status, String result,
			String outcome, Integer progress, Instant startAt, Instant endAt, Integer durationMin) {
	}

	private final JdbcClient jdbc;

	RecordExportRows(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	List<Line> find(UUID ownerId, LocalDate from, LocalDate to) {
		return jdbc.sql("""
				SELECT r.work_date, r.content, t.title AS task_title, p.name AS project_name, r.status, r.result, r.outcome,
				       r.progress, r.start_at, r.end_at, r.duration_min
				FROM work_record r
				LEFT JOIN task t ON t.id = r.task_id
				LEFT JOIN project p ON p.id = t.project_id
				WHERE r.owner_id = :owner AND r.deleted_at IS NULL AND r.work_date BETWEEN :from AND :to
				  AND NOT (r.start_at IS NOT NULL AND r.end_at IS NULL AND r.duration_min IS NULL)
				ORDER BY r.work_date, r.start_at NULLS LAST, r.created_at, r.id""")
			.param("owner", ownerId).param("from", from).param("to", to)
			.query((rs, i) -> new Line(rs.getObject("work_date", LocalDate.class), rs.getString("content"),
					rs.getString("task_title"), rs.getString("project_name"), rs.getString("status"), rs.getString("result"),
					rs.getString("outcome"), (Integer) rs.getObject("progress"), instant(rs.getObject("start_at", OffsetDateTime.class)),
					instant(rs.getObject("end_at", OffsetDateTime.class)), (Integer) rs.getObject("duration_min")))
			.list();
	}

	private static Instant instant(OffsetDateTime t) {
		return t == null ? null : t.toInstant();
	}
}

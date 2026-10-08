package com.erp.worklog.journal;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * 일지의 원본: 확정 기록(보관 제외, 실행 중 타이머 제외)과 완료한 업무 (LOG-01·15). 호출하는 쪽의 트랜잭션 안에서 부른다.
 * 기록은 workDate로, 업무 완료는 사용자의 현재 시간대로 날짜를 정한다.
 */
@Component
class LogSources {

	/** 실행 중인 타이머 모양(V7 work_record_one_running)이 아닌 기록. */
	private static final String NOT_RUNNING = "NOT (start_at IS NOT NULL AND end_at IS NULL AND duration_min IS NULL)";

	record Rec(UUID id, LocalDate workDate, String content, String result, String outcome, Integer progress, UUID taskId,
			Integer durationMin) {
	}

	record DoneTask(UUID id, String title, UUID projectId, LocalDate date) {
	}

	record TaskInfo(UUID id, String title, String status, LocalDate dueDate, int progress, UUID projectId) {
	}

	private final JdbcClient jdbc;

	LogSources(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** [from, to]의 확정 기록. 정렬: workDate → startAt(없으면 뒤) → occurrenceStart(없으면 뒤) → id (기록 목록과 같음). */
	List<Rec> records(UUID ownerId, LocalDate from, LocalDate to) {
		return jdbc.sql("""
				SELECT id, work_date, content, result, outcome, progress, task_id, duration_min FROM work_record
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'CONFIRMED' AND work_date BETWEEN :from AND :to
				  AND %s
				ORDER BY work_date, start_at NULLS LAST, occurrence_start NULLS LAST, id""".formatted(NOT_RUNNING))
			.param("owner", ownerId).param("from", from).param("to", to)
			.query((rs, i) -> new Rec(rs.getObject("id", UUID.class), rs.getObject("work_date", LocalDate.class),
					rs.getString("content"), rs.getString("result"), rs.getString("outcome"),
					(Integer) rs.getObject("progress", Integer.class), rs.getObject("task_id", UUID.class),
					(Integer) rs.getObject("duration_min", Integer.class)))
			.list();
	}

	/** 실적 줄이 가리키는 내 기록 (보관 제외, 상태 무관). */
	Map<UUID, Rec> recordsById(UUID ownerId, Collection<UUID> ids) {
		Map<UUID, Rec> found = new HashMap<>();
		if (ids.isEmpty()) {
			return found;
		}
		jdbc.sql("""
				SELECT id, work_date, content, result, outcome, progress, task_id, duration_min FROM work_record
				WHERE owner_id = :owner AND id IN (:ids) AND deleted_at IS NULL""")
			.param("owner", ownerId).param("ids", ids)
			.query((rs, i) -> found.put(rs.getObject("id", UUID.class), new Rec(rs.getObject("id", UUID.class),
					rs.getObject("work_date", LocalDate.class), rs.getString("content"), rs.getString("result"),
					rs.getString("outcome"), (Integer) rs.getObject("progress", Integer.class),
					rs.getObject("task_id", UUID.class), (Integer) rs.getObject("duration_min", Integer.class))))
			.list();
		return found;
	}

	int pendingCount(UUID ownerId, LocalDate from, LocalDate to) {
		return jdbc.sql("""
				SELECT count(*) FROM work_record
				WHERE owner_id = ? AND deleted_at IS NULL AND status = 'PENDING' AND work_date BETWEEN ? AND ?""")
			.params(ownerId, from, to)
			.query(Integer.class)
			.single();
	}

	/** [from, to](사용자 시간대 날짜)에 완료한 보관하지 않은 업무. 완료 시각순. */
	List<DoneTask> completedTasks(UUID ownerId, ZoneId zone, LocalDate from, LocalDate to) {
		return jdbc.sql("""
				SELECT id, title, project_id, completed_at FROM task
				WHERE owner_id = :owner AND deleted_at IS NULL AND status = 'DONE'
				  AND completed_at >= :start AND completed_at < :end
				ORDER BY completed_at, id""")
			.param("owner", ownerId).param("start", startOf(from, zone)).param("end", startOf(to.plusDays(1), zone))
			.query((rs, i) -> new DoneTask(rs.getObject("id", UUID.class), rs.getString("title"),
					rs.getObject("project_id", UUID.class),
					LocalDate.ofInstant(rs.getObject("completed_at", OffsetDateTime.class).toInstant(), zone)))
			.list();
	}

	/** 업무 정보 (보관한 업무 포함 — 실적 줄의 프로젝트 이름·계획의 마감일). */
	Map<UUID, TaskInfo> tasks(UUID ownerId, Collection<UUID> ids) {
		Map<UUID, TaskInfo> found = new HashMap<>();
		if (ids.isEmpty()) {
			return found;
		}
		jdbc.sql("SELECT id, title, status, due_date, progress, project_id FROM task WHERE owner_id = :owner AND id IN (:ids)")
			.param("owner", ownerId).param("ids", ids)
			.query((rs, i) -> found.put(rs.getObject("id", UUID.class), task(rs)))
			.list();
		return found;
	}

	/** 보관하지 않은 할 일·진행 중 업무 (계획 후보·이월 후보). */
	List<TaskInfo> openTasks(UUID ownerId) {
		return jdbc.sql("""
				SELECT id, title, status, due_date, progress, project_id FROM task
				WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('TODO', 'IN_PROGRESS')""")
			.param(ownerId)
			.query((rs, i) -> task(rs))
			.list();
	}

	Map<UUID, String> projectNames(UUID ownerId, Collection<UUID> ids) {
		Map<UUID, String> found = new HashMap<>();
		if (ids.isEmpty()) {
			return found;
		}
		jdbc.sql("SELECT id, name FROM project WHERE owner_id = :owner AND id IN (:ids)")
			.param("owner", ownerId).param("ids", ids)
			.query((rs, i) -> found.put(rs.getObject("id", UUID.class), rs.getString("name")))
			.list();
		return found;
	}

	/** 원본이 있는 날: 보관하지 않은 확정·확인 대기 기록(실행 중 제외)이 있거나 업무를 완료한 날 (LOG-09 미작성 판단). */
	Set<LocalDate> sourceDates(UUID ownerId, ZoneId zone, LocalDate from, LocalDate to) {
		Set<LocalDate> dates = new TreeSet<>(jdbc.sql("""
				SELECT DISTINCT work_date FROM work_record
				WHERE owner_id = :owner AND deleted_at IS NULL AND status IN ('CONFIRMED', 'PENDING')
				  AND work_date BETWEEN :from AND :to AND %s""".formatted(NOT_RUNNING))
			.param("owner", ownerId).param("from", from).param("to", to)
			.query(LocalDate.class)
			.list());
		for (DoneTask t : completedTasks(ownerId, zone, from, to)) {
			dates.add(t.date());
		}
		return dates;
	}

	/**
	 * since 뒤에 그 기간의 원본이 바뀌었는지: 기간 안 기록(보관 포함)의 수정, 기간 안에 완료한 업무나 스냅샷이 가리키는 업무의 수정.
	 * 기록을 다른 날로 옮긴 경우는 옮겨 간 날 기준으로만 보인다.
	 */
	boolean changedSince(UUID ownerId, ZoneId zone, LocalDate from, LocalDate to, Instant since, Collection<UUID> taskIds) {
		OffsetDateTime at = OffsetDateTime.ofInstant(since, ZoneOffset.UTC);
		boolean records = jdbc.sql("""
				SELECT EXISTS (SELECT 1 FROM work_record WHERE owner_id = :owner AND work_date BETWEEN :from AND :to
				                                         AND updated_at > :since)""")
			.param("owner", ownerId).param("from", from).param("to", to).param("since", at)
			.query(Boolean.class)
			.single();
		if (records) {
			return true;
		}
		return jdbc.sql("""
				SELECT EXISTS (SELECT 1 FROM task WHERE owner_id = :owner AND updated_at > :since
				               AND ((completed_at >= :start AND completed_at < :end) OR id IN (:ids)))""")
			.param("owner", ownerId).param("since", at).param("start", startOf(from, zone))
			.param("end", startOf(to.plusDays(1), zone))
			// 빈 IN ()은 SQL 오류라 없는 id 하나를 넣는다
			.param("ids", taskIds.isEmpty() ? List.of(new UUID(0, 0)) : taskIds)
			.query(Boolean.class)
			.single();
	}

	private static TaskInfo task(java.sql.ResultSet rs) throws java.sql.SQLException {
		return new TaskInfo(rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("status"),
				rs.getObject("due_date", LocalDate.class), rs.getInt("progress"), rs.getObject("project_id", UUID.class));
	}

	private static OffsetDateTime startOf(LocalDate date, ZoneId zone) {
		return OffsetDateTime.ofInstant(date.atStartOfDay(zone).toInstant(), ZoneOffset.UTC);
	}
}

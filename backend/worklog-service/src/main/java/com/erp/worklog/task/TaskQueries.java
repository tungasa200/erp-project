package com.erp.worklog.task;

import com.erp.common.error.ApiException;
import com.erp.worklog.task.TaskService.TaskInfo;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 업무 목록 (P1-03·04, contracts/worklog.yaml listTasks). 필터 조합이 많아 SQL로 직접 만들고, 태그는 한 번에 모은다.
 * 정렬은 due(마감일 오름차순, 없으면 뒤 → id) 또는 created(id 역순). UUIDv7이라 id 순서가 생성 순서다.
 * cursor는 마지막 행의 정렬 값을 담은 불투명 문자열이다.
 */
@Component
public class TaskQueries {

	public enum Sort {
		due, created
	}

	public record Filter(boolean deleted, List<String> statuses, List<UUID> projectIds, List<UUID> tagIds,
			LocalDate dueFrom, LocalDate dueTo, Instant completedSince, String q, Boolean scheduled, Sort sort) {
	}

	public record Page(List<TaskInfo> items, String nextCursor) {
	}

	private static final String HAS_SCHEDULE = "EXISTS (SELECT 1 FROM schedule s WHERE s.task_id = t.id)";

	private final JdbcClient jdbc;

	TaskQueries(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	@Transactional(readOnly = true)
	public Page list(UUID ownerId, Filter f, String cursor, int limit) {
		StringBuilder where = new StringBuilder("t.owner_id = :owner");
		Map<String, Object> params = new HashMap<>();
		params.put("owner", ownerId);

		where.append(f.deleted() ? " AND t.deleted_at IS NOT NULL" : " AND t.deleted_at IS NULL");
		if (!f.deleted() && f.projectIds().isEmpty()) {
			// 보관한 프로젝트의 업무는 기본 목록에서 숨긴다. 프로젝트로 거르면 보여준다
			where.append(" AND NOT EXISTS (SELECT 1 FROM project p WHERE p.id = t.project_id AND p.archived_at IS NOT NULL)");
		}
		if (!f.statuses().isEmpty()) {
			where.append(" AND t.status IN (:statuses)");
			params.put("statuses", f.statuses());
		}
		if (!f.projectIds().isEmpty()) {
			where.append(" AND t.project_id IN (:projects)");
			params.put("projects", f.projectIds());
		}
		if (!f.tagIds().isEmpty()) {
			where.append(" AND EXISTS (SELECT 1 FROM task_tag x WHERE x.task_id = t.id AND x.tag_id IN (:tags))");
			params.put("tags", f.tagIds());
		}
		if (f.dueFrom() != null) {
			where.append(" AND t.due_date >= :dueFrom");
			params.put("dueFrom", f.dueFrom());
		}
		if (f.dueTo() != null) {
			where.append(" AND t.due_date <= :dueTo");
			params.put("dueTo", f.dueTo());
		}
		if (f.completedSince() != null) {
			where.append(" AND (t.status <> 'DONE' OR t.completed_at >= :completedSince)");
			params.put("completedSince", OffsetDateTime.ofInstant(f.completedSince(), ZoneOffset.UTC));
		}
		if (f.scheduled() != null) {
			// 일정 연결은 시리즈 단위(schedule.task_id). SCH-07 캘린더 업무 패널은 scheduled=false
			where.append(f.scheduled() ? " AND " : " AND NOT ").append(HAS_SCHEDULE);
		}
		if (f.q() != null && !f.q().isBlank()) {
			where.append(" AND t.title ILIKE :q ESCAPE '\\'");
			params.put("q", "%" + f.q().strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
		}

		String order;
		if (f.sort() == Sort.due) {
			order = "t.due_date ASC NULLS LAST, t.id ASC";
			if (cursor != null) {
				DueCursor c = DueCursor.decode(cursor);
				params.put("cid", c.id());
				if (c.dueDate() == null) {
					where.append(" AND t.due_date IS NULL AND t.id > :cid");
				} else {
					where.append(" AND (t.due_date > :cdue OR (t.due_date = :cdue AND t.id > :cid) OR t.due_date IS NULL)");
					params.put("cdue", c.dueDate());
				}
			}
		} else {
			order = "t.id DESC";
			if (cursor != null) {
				where.append(" AND t.id < :cid");
				params.put("cid", CreatedCursor.decode(cursor));
			}
		}
		params.put("limit", limit + 1);

		List<TaskInfo> rows = jdbc.sql("""
						SELECT t.*,
						       ARRAY(SELECT tt.tag_id FROM task_tag tt WHERE tt.task_id = t.id ORDER BY tt.tag_id) AS tag_ids,
						       %s AS has_schedule
						FROM task t
						WHERE %s
						ORDER BY %s
						LIMIT :limit""".formatted(HAS_SCHEDULE, where, order))
				.params(params)
				.query((rs, i) -> row(rs))
				.list();

		if (rows.size() <= limit) {
			return new Page(rows, null);
		}
		List<TaskInfo> items = new ArrayList<>(rows.subList(0, limit));
		TaskInfo last = items.getLast();
		String next = f.sort() == Sort.due ? new DueCursor(last.dueDate(), last.id()).encode()
				: CreatedCursor.encode(last.id());
		return new Page(items, next);
	}

	private static TaskInfo row(ResultSet rs) throws SQLException {
		Array tagArray = rs.getArray("tag_ids");
		List<UUID> tagIds = Arrays.stream((Object[]) tagArray.getArray()).map(UUID.class::cast).toList();
		return new TaskInfo(rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("status"),
				rs.getString("priority"), rs.getObject("due_date", LocalDate.class), rs.getInt("progress"),
				instant(rs, "completed_at"), rs.getObject("project_id", UUID.class), tagIds,
				rs.getBoolean("has_schedule"), rs.getString("memo"),
				rs.getObject("carried_over_from", UUID.class), instant(rs, "deleted_at"), instant(rs, "created_at"),
				instant(rs, "updated_at"), rs.getLong("version"));
	}

	private static Instant instant(ResultSet rs, String column) throws SQLException {
		OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
		return value == null ? null : value.toInstant();
	}

	static ApiException invalidCursor() {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "목록 위치가 올바르지 않아요. 처음부터 다시 불러와 주세요.");
	}

	/** "d:<날짜 또는 ->:<id>" */
	record DueCursor(LocalDate dueDate, UUID id) {

		String encode() {
			return encodeRaw("d:" + (dueDate == null ? "-" : dueDate) + ":" + id);
		}

		static DueCursor decode(String cursor) {
			String[] parts = decodeRaw(cursor).split(":", 3);
			if (parts.length != 3 || !parts[0].equals("d")) {
				throw invalidCursor();
			}
			try {
				return new DueCursor(parts[1].equals("-") ? null : LocalDate.parse(parts[1]), UUID.fromString(parts[2]));
			} catch (RuntimeException e) {
				throw invalidCursor();
			}
		}
	}

	/** "c:<id>" */
	static final class CreatedCursor {

		private CreatedCursor() {
		}

		static String encode(UUID id) {
			return encodeRaw("c:" + id);
		}

		static UUID decode(String cursor) {
			String raw = decodeRaw(cursor);
			if (!raw.startsWith("c:")) {
				throw invalidCursor();
			}
			try {
				return UUID.fromString(raw.substring(2));
			} catch (IllegalArgumentException e) {
				throw invalidCursor();
			}
		}
	}

	private static String encodeRaw(String raw) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
	}

	private static String decodeRaw(String cursor) {
		try {
			return new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
		} catch (IllegalArgumentException e) {
			throw invalidCursor();
		}
	}
}

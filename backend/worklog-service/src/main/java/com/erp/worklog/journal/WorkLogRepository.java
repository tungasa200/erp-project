package com.erp.worklog.journal;

import com.erp.worklog.journal.LogViews.Revision;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** work_log·work_log_revision (V8). content는 JSON 문자열로 주고받는다. */
@Repository
class WorkLogRepository {

	record Row(UUID id, LogType type, LocalDate periodStart, LocalDate periodEnd, boolean confirmed, String content,
			Instant confirmedAt, long version) {
	}

	private static final String COLUMNS = "id, type, period_start, period_end, status, content::text AS content, confirmed_at, version";

	private final JdbcClient jdbc;

	WorkLogRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	Optional<Row> find(UUID ownerId, LogType type, LocalDate periodStart) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM work_log WHERE owner_id = ? AND type = ? AND period_start = ?")
			.params(ownerId, type.name(), periodStart)
			.query(WorkLogRepository::row)
			.optional();
	}

	/** 고치기 전에 행을 잠근다(확정 이력 번호가 겹치지 않게). */
	Optional<Row> findForUpdate(UUID ownerId, UUID id) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM work_log WHERE id = ? AND owner_id = ? FOR UPDATE")
			.params(id, ownerId)
			.query(WorkLogRepository::row)
			.optional();
	}

	Optional<Row> findById(UUID ownerId, UUID id) {
		return jdbc.sql("SELECT " + COLUMNS + " FROM work_log WHERE id = ? AND owner_id = ?")
			.params(id, ownerId)
			.query(WorkLogRepository::row)
			.optional();
	}

	/** 기간 시작일이 [from, to]인 일지. */
	List<Row> findStarting(UUID ownerId, LogType type, LocalDate from, LocalDate to) {
		return jdbc.sql("SELECT " + COLUMNS + """
				 FROM work_log WHERE owner_id = ? AND type = ? AND period_start BETWEEN ? AND ? ORDER BY period_start""")
			.params(ownerId, type.name(), from, to)
			.query(WorkLogRepository::row)
			.list();
	}

	/** 초안을 넣는다. 같은 기간이 이미 있으면 넣지 않고 false (UNIQUE, 동시에 불려도 하나). */
	boolean insertDraft(UUID id, UUID ownerId, LogType type, LocalDate start, LocalDate end, String content, Instant now) {
		return jdbc.sql("""
				INSERT INTO work_log (id, owner_id, type, period_start, period_end, status, content, version, created_at, updated_at)
				VALUES (:id, :owner, :type, :start, :end, 'DRAFT', CAST(:content AS jsonb), 0, :now, :now)
				ON CONFLICT (owner_id, type, period_start) DO NOTHING""")
			.param("id", id).param("owner", ownerId).param("type", type.name()).param("start", start).param("end", end)
			.param("content", content).param("now", utc(now))
			.update() == 1;
	}

	/** version이 같을 때만 바꾸고 version을 올린다. 바꾼 행이 없으면 false. */
	boolean update(UUID id, long version, boolean confirmed, String content, Instant confirmedAt, Instant now) {
		return jdbc.sql("""
				UPDATE work_log SET status = :status, content = CAST(:content AS jsonb), confirmed_at = :confirmedAt,
				       version = version + 1, updated_at = :now
				WHERE id = :id AND version = :version""")
			.param("status", confirmed ? "CONFIRMED" : "DRAFT").param("content", content)
			.param("confirmedAt", confirmedAt == null ? null : utc(confirmedAt)).param("now", utc(now))
			.param("id", id).param("version", version)
			.update() == 1;
	}

	void addRevision(UUID logId, String content, Instant confirmedAt) {
		jdbc.sql("""
				INSERT INTO work_log_revision (log_id, revision_no, content, confirmed_at)
				SELECT :id, coalesce(max(revision_no), 0) + 1, CAST(:content AS jsonb), :at FROM work_log_revision WHERE log_id = :id""")
			.param("id", logId).param("content", content).param("at", utc(confirmedAt))
			.update();
	}

	/** 지금 확정본(해제 시각이 없는 마지막 이력)에 해제 시각을 적는다. */
	void markUnconfirmed(UUID logId, Instant at) {
		jdbc.sql("""
				UPDATE work_log_revision SET unconfirmed_at = :at
				WHERE log_id = :id AND unconfirmed_at IS NULL
				  AND revision_no = (SELECT max(revision_no) FROM work_log_revision WHERE log_id = :id)""")
			.param("id", logId).param("at", utc(at))
			.update();
	}

	List<Revision> revisions(UUID logId) {
		return jdbc.sql("""
				SELECT revision_no, confirmed_at, unconfirmed_at FROM work_log_revision WHERE log_id = ? ORDER BY revision_no DESC""")
			.param(logId)
			.query((rs, i) -> revision(rs))
			.list();
	}

	record RevisionRow(Revision revision, String content) {
	}

	Optional<RevisionRow> revision(UUID logId, int revisionNo) {
		return jdbc.sql("""
				SELECT revision_no, confirmed_at, unconfirmed_at, content::text AS content
				FROM work_log_revision WHERE log_id = ? AND revision_no = ?""")
			.params(logId, revisionNo)
			.query((rs, i) -> new RevisionRow(revision(rs), rs.getString("content")))
			.optional();
	}

	private static Revision revision(ResultSet rs) throws SQLException {
		OffsetDateTime unconfirmed = rs.getObject("unconfirmed_at", OffsetDateTime.class);
		return new Revision(rs.getInt("revision_no"), rs.getObject("confirmed_at", OffsetDateTime.class).toInstant(),
				unconfirmed == null ? null : unconfirmed.toInstant());
	}

	private static Row row(ResultSet rs, int i) throws SQLException {
		OffsetDateTime confirmedAt = rs.getObject("confirmed_at", OffsetDateTime.class);
		return new Row(rs.getObject("id", UUID.class), LogType.valueOf(rs.getString("type")),
				rs.getObject("period_start", LocalDate.class), rs.getObject("period_end", LocalDate.class),
				"CONFIRMED".equals(rs.getString("status")), rs.getString("content"),
				confirmedAt == null ? null : confirmedAt.toInstant(), rs.getLong("version"));
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}
}

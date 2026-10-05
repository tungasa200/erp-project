package com.erp.worklog.user;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class UserSnapshotRepository {

	public record UserSnapshot(UUID userId, Profile profile, Instant syncedAt) {
	}

	private final JdbcClient jdbc;

	UserSnapshotRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<UserSnapshot> find(UUID userId) {
		return jdbc.sql("""
						SELECT user_id, name, organization, position, timezone, week_start, work_days, synced_at
						FROM user_snapshot WHERE user_id = ?""")
				.param(userId)
				.query((rs, i) -> new UserSnapshot(
						rs.getObject("user_id", UUID.class),
						new Profile(rs.getString("name"), rs.getString("organization"), rs.getString("position"),
								rs.getString("timezone"), rs.getString("week_start"), rs.getInt("work_days")),
						rs.getObject("synced_at", OffsetDateTime.class).toInstant()))
				.optional();
	}

	/** 피드·전체 목록 반영. 이미 더 최근 seq를 반영했으면 무시한다 (멱등, 5.4). */
	public void upsert(UUID userId, Profile p, long seq) {
		jdbc.sql("""
						INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, last_seq, synced_at)
						VALUES (:id, :name, :org, :pos, :tz, :ws, :wd, :seq, now())
						ON CONFLICT (user_id) DO UPDATE SET
						    name = EXCLUDED.name, organization = EXCLUDED.organization, position = EXCLUDED.position,
						    timezone = EXCLUDED.timezone, week_start = EXCLUDED.week_start, work_days = EXCLUDED.work_days,
						    last_seq = EXCLUDED.last_seq, synced_at = EXCLUDED.synced_at
						WHERE user_snapshot.last_seq < EXCLUDED.last_seq""")
				.params(params(userId, p, seq))
				.update();
	}

	/** 즉시 조회로 만든 사본. 그 사이 피드가 먼저 넣었으면 그것을 둔다. */
	public void insertIfAbsent(UUID userId, Profile p) {
		jdbc.sql("""
						INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, last_seq, synced_at)
						VALUES (:id, :name, :org, :pos, :tz, :ws, :wd, :seq, now())
						ON CONFLICT (user_id) DO NOTHING""")
				.params(params(userId, p, 0))
				.update();
	}

	public void delete(UUID userId) {
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id = ?").param(userId).update();
	}

	private static Map<String, Object> params(UUID userId, Profile p, long seq) {
		var map = new HashMap<String, Object>();
		map.put("id", userId);
		map.put("name", p.name());
		map.put("org", p.organization());
		map.put("pos", p.position());
		map.put("tz", p.timezone());
		map.put("ws", p.weekStart());
		map.put("wd", p.workDays());
		map.put("seq", seq);
		return map;
	}
}

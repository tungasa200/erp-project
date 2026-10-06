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
						SELECT user_id, name, organization, position, timezone, week_start, work_days, profile_version, synced_at
						FROM user_snapshot WHERE user_id = ?""")
				.param(userId)
				.query((rs, i) -> new UserSnapshot(
						rs.getObject("user_id", UUID.class),
						new Profile(rs.getString("name"), rs.getString("organization"), rs.getString("position"),
								rs.getString("timezone"), rs.getString("week_start"), rs.getInt("work_days"),
								rs.getLong("profile_version")),
						rs.getObject("synced_at", OffsetDateTime.class).toInstant()))
				.optional();
	}

	/**
	 * 피드·전체 목록·즉시 갱신 반영. 사본의 프로필 version이 같거나 더 크면 무시한다 (멱등, 5.4).
	 * seq가 아니라 version으로 비교하는 이유: 즉시 갱신은 seq를 모르고, 늦게 처리된 오래된 피드 이벤트가 새 값을 되돌리면 안 된다.
	 * seq는 즉시 갱신이면 0이며, 기록용으로 큰 값을 남긴다.
	 */
	public void upsert(UUID userId, Profile p, long seq) {
		jdbc.sql("""
						INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, profile_version, last_seq, synced_at)
						VALUES (:id, :name, :org, :pos, :tz, :ws, :wd, :ver, :seq, now())
						ON CONFLICT (user_id) DO UPDATE SET
						    name = EXCLUDED.name, organization = EXCLUDED.organization, position = EXCLUDED.position,
						    timezone = EXCLUDED.timezone, week_start = EXCLUDED.week_start, work_days = EXCLUDED.work_days,
						    profile_version = EXCLUDED.profile_version,
						    last_seq = GREATEST(user_snapshot.last_seq, EXCLUDED.last_seq), synced_at = EXCLUDED.synced_at
						WHERE user_snapshot.profile_version < EXCLUDED.profile_version""")
				.params(params(userId, p, seq))
				.update();
	}

	/** 즉시 조회로 만든 사본. 그 사이 피드가 먼저 넣었으면 그것을 둔다. */
	public void insertIfAbsent(UUID userId, Profile p) {
		jdbc.sql("""
						INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, profile_version, last_seq, synced_at)
						VALUES (:id, :name, :org, :pos, :tz, :ws, :wd, :ver, :seq, now())
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
		map.put("ver", p.version());
		map.put("seq", seq);
		return map;
	}
}

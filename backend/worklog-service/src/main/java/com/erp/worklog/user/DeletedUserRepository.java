package com.erp.worklog.user;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/** 탈퇴 사용자 요청 거부 목록 (D-45). */
@Repository
public class DeletedUserRepository {

	private final JdbcClient jdbc;

	DeletedUserRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public boolean contains(UUID userId) {
		return jdbc.sql("SELECT EXISTS (SELECT 1 FROM deleted_user WHERE user_id = ?)").param(userId)
				.query(Boolean.class).single();
	}

	public void add(UUID userId) {
		jdbc.sql("INSERT INTO deleted_user (user_id, deleted_at) VALUES (?, now()) ON CONFLICT (user_id) DO NOTHING")
				.param(userId).update();
	}

	public List<UUID> findNotRepurgedBefore(Instant before) {
		return jdbc.sql("SELECT user_id FROM deleted_user WHERE repurged_at IS NULL AND deleted_at < ?")
				.param(utc(before)).query(UUID.class).list();
	}

	public void markRepurged(UUID userId) {
		jdbc.sql("UPDATE deleted_user SET repurged_at = now() WHERE user_id = ?").param(userId).update();
	}

	/** 다시 파기를 마친 행만 지운다. 아직 재파기 전이면 남겨 둔다. */
	public int deleteRepurgedBefore(Instant before) {
		return jdbc.sql("DELETE FROM deleted_user WHERE repurged_at IS NOT NULL AND deleted_at < ?")
				.param(utc(before)).update();
	}

	private static OffsetDateTime utc(Instant instant) {
		return instant.atOffset(ZoneOffset.UTC);
	}
}

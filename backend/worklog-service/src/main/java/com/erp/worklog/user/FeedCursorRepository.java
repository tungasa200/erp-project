package com.erp.worklog.user;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/** 사용자 변경 피드 소비 위치 (단일 행, D-45). 비어 있으면 아직 전체 동기화 전이다. */
@Repository
public class FeedCursorRepository {

	private final JdbcClient jdbc;

	FeedCursorRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Optional<Long> lastSeq() {
		return jdbc.sql("SELECT last_seq FROM feed_cursor WHERE id = 1 AND last_seq IS NOT NULL").query(Long.class).optional();
	}

	public void save(long lastSeq) {
		jdbc.sql("UPDATE feed_cursor SET last_seq = ?, updated_at = now() WHERE id = 1").param(lastSeq).update();
	}
}

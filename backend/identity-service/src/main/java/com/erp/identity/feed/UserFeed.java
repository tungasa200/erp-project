package com.erp.identity.feed;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.json.JsonMapper;

import com.erp.identity.user.Profile;

/**
 * 사용자 변경 피드 기록 (5.4). 호출한 트랜잭션 안에서 쓴다.
 * 기록 전에 트랜잭션 단위 advisory lock을 잡아 커밋까지 다른 기록을 막는다. seq 발급 순서와 커밋 순서가
 * 어긋나면 소비자가 이미 지나간 seq의 이벤트를 영구히 건너뛰기 때문이다.
 */
@Component
public class UserFeed {

	/** pg_advisory_xact_lock 키. identity schema 안에서 피드 기록 전용으로만 쓴다. */
	private static final long FEED_LOCK_KEY = 7_001L;

	private final JdbcTemplate jdbc;

	private final JsonMapper json;

	public UserFeed(JdbcTemplate jdbc, JsonMapper json) {
		this.jdbc = jdbc;
		this.json = json;
	}

	@Transactional(propagation = Propagation.MANDATORY)
	public void created(UUID userId, Profile profile, Instant now) {
		append(UserEventType.CREATED, userId, json.writeValueAsString(profile), now);
	}

	/**
	 * 탈퇴 이벤트를 남기고 그 사용자의 과거 CREATED·PROFILE_UPDATED 행을 지운다.
	 * 피드에 프로필이 30일 동안 남지 않게 하기 위해서이며, 그래서 seq는 연속이 아닐 수 있다(contracts/identity.yaml).
	 */
	@Transactional(propagation = Propagation.MANDATORY)
	public void deleted(UUID userId, Instant now) {
		append(UserEventType.DELETED, userId, null, now);
		jdbc.update("DELETE FROM user_events WHERE user_id = ? AND type IN (?, ?)", userId,
				UserEventType.CREATED.name(), UserEventType.PROFILE_UPDATED.name());
	}

	private void append(UserEventType type, UUID userId, String payload, Instant now) {
		jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, FEED_LOCK_KEY);
		jdbc.update("INSERT INTO user_events (type, user_id, payload, created_at) VALUES (?, ?, ?::jsonb, ?)",
				type.name(), userId, payload, OffsetDateTime.ofInstant(now, ZoneOffset.UTC));
	}

}

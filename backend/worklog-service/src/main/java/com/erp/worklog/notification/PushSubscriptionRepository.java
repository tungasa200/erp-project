package com.erp.worklog.notification;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/** 브라우저별 웹 푸시 구독 (P4-01). endpoint가 키다. */
@Repository
class PushSubscriptionRepository {

	static final int MAX_PER_USER = 10;

	record Subscription(String endpoint, String p256dh, String auth) {
	}

	private final JdbcClient jdbc;

	PushSubscriptionRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** endpoint가 같으면 덮어쓴다(다른 사용자 것이었으면 이 사용자로 옮긴다). 10개를 넘으면 가장 오래 쓰지 않은 것부터 지운다. */
	@Transactional
	void save(UUID ownerId, String endpoint, String p256dh, String auth, Instant now) {
		jdbc.sql("""
				INSERT INTO push_subscription (endpoint, owner_id, p256dh, auth, created_at, last_used_at)
				VALUES (:endpoint, :owner, :p256dh, :auth, :now, :now)
				ON CONFLICT (endpoint) DO UPDATE SET owner_id = EXCLUDED.owner_id, p256dh = EXCLUDED.p256dh,
				    auth = EXCLUDED.auth, last_used_at = EXCLUDED.last_used_at""")
			.param("endpoint", endpoint).param("owner", ownerId).param("p256dh", p256dh).param("auth", auth)
			.param("now", utc(now))
			.update();
		jdbc.sql("""
				DELETE FROM push_subscription WHERE endpoint IN (
				    SELECT endpoint FROM push_subscription WHERE owner_id = :owner
				    ORDER BY last_used_at DESC, endpoint OFFSET :max)""")
			.param("owner", ownerId).param("max", MAX_PER_USER)
			.update();
	}

	void delete(UUID ownerId, String endpoint) {
		jdbc.sql("DELETE FROM push_subscription WHERE owner_id = :owner AND endpoint = :endpoint")
			.param("owner", ownerId).param("endpoint", endpoint)
			.update();
	}

	/** 푸시 서비스가 404·410으로 없앤 구독. 그 사이 다른 사용자로 옮겨졌어도 같은 브라우저 구독이라 지운다. */
	void deleteGone(String endpoint) {
		jdbc.sql("DELETE FROM push_subscription WHERE endpoint = ?").param(endpoint).update();
	}

	List<Subscription> findByOwner(UUID ownerId) {
		return jdbc.sql("SELECT endpoint, p256dh, auth FROM push_subscription WHERE owner_id = ? ORDER BY last_used_at DESC")
			.param(ownerId)
			.query((rs, i) -> new Subscription(rs.getString("endpoint"), rs.getString("p256dh"), rs.getString("auth")))
			.list();
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}
}

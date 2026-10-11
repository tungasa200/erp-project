package com.erp.worklog.notification;

import com.erp.common.error.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** 알림 센터 항목 (P4-01, contracts/worklog.yaml notifications). */
@Repository
public class NotificationRepository {

	public record Notification(UUID id, String type, LocalDate date, Integer pendingCount, String logType,
			LocalDate periodStart, Instant createdAt, Instant readAt) {
	}

	public record Page(List<Notification> items, int unreadCount, String nextCursor) {
	}

	private final JdbcClient jdbc;

	NotificationRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** 같은 (종류, 날, 일지 종류)가 이미 있으면 넣지 않고 빈 값. 재시도·중복 실행에도 한 번만 만든다. */
	public Optional<UUID> insert(UUID ownerId, String type, LocalDate date, Integer pendingCount, String logType,
			LocalDate periodStart, Instant now) {
		// timestamptz는 마이크로초까지라 cursor 비교가 맞도록 미리 자른다
		Instant createdAt = now.truncatedTo(ChronoUnit.MICROS);
		return jdbc.sql("""
				INSERT INTO notification (id, owner_id, type, date, pending_count, log_type, period_start, created_at)
				VALUES (:id, :owner, :type, :date, :pending, :logType, :periodStart, :createdAt)
				ON CONFLICT DO NOTHING
				RETURNING id""")
			.param("id", uuidV7(createdAt)).param("owner", ownerId).param("type", type).param("date", date)
			.param("pending", pendingCount).param("logType", logType).param("periodStart", periodStart)
			.param("createdAt", utc(createdAt))
			.query(UUID.class).optional();
	}

	/** 최신순(createdAt 내림차순 → id 내림차순). unreadCount는 페이지와 무관한 전체 수. */
	public Page list(UUID ownerId, String cursor, int limit) {
		Instant afterCreated = null;
		UUID afterId = null;
		if (cursor != null) {
			String[] parts = decode(cursor).split("\\|", 2);
			try {
				afterCreated = Instant.parse(parts[0]);
				afterId = UUID.fromString(parts[1]);
			} catch (RuntimeException e) {
				throw invalidCursor();
			}
		}
		var sql = jdbc.sql("""
				SELECT id, type, date, pending_count, log_type, period_start, created_at, read_at FROM notification
				WHERE owner_id = :owner""" + (afterCreated == null ? "" : " AND (created_at, id) < (:afterCreated, :afterId)") + """

				ORDER BY created_at DESC, id DESC
				LIMIT :limit""")
			.param("owner", ownerId).param("limit", limit + 1);
		if (afterCreated != null) {
			sql = sql.param("afterCreated", utc(afterCreated)).param("afterId", afterId);
		}
		List<Notification> rows = sql.query((rs, i) -> row(rs)).list();
		String next = null;
		if (rows.size() > limit) {
			rows = rows.subList(0, limit);
			Notification last = rows.get(limit - 1);
			next = encode(last.createdAt() + "|" + last.id());
		}
		int unread = jdbc.sql("SELECT count(*) FROM notification WHERE owner_id = :owner AND read_at IS NULL")
			.param("owner", ownerId).query(Integer.class).single();
		return new Page(rows, unread, next);
	}

	/** 내 알림이면 true(이미 읽었어도). */
	public boolean markRead(UUID ownerId, UUID id, Instant now) {
		return jdbc.sql("UPDATE notification SET read_at = coalesce(read_at, :now) WHERE owner_id = :owner AND id = :id")
			.param("now", utc(now)).param("owner", ownerId).param("id", id)
			.update() > 0;
	}

	public void markAllRead(UUID ownerId, Instant now) {
		jdbc.sql("UPDATE notification SET read_at = :now WHERE owner_id = :owner AND read_at IS NULL")
			.param("now", utc(now)).param("owner", ownerId)
			.update();
	}

	int deleteCreatedBefore(Instant before) {
		return jdbc.sql("DELETE FROM notification WHERE created_at < :before").param("before", utc(before)).update();
	}

	private static Notification row(ResultSet rs) throws SQLException {
		OffsetDateTime read = rs.getObject("read_at", OffsetDateTime.class);
		return new Notification(rs.getObject("id", UUID.class), rs.getString("type"),
				rs.getObject("date", LocalDate.class), (Integer) rs.getObject("pending_count"), rs.getString("log_type"),
				rs.getObject("period_start", LocalDate.class), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
				read == null ? null : read.toInstant());
	}

	private static ApiException invalidCursor() {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "목록 위치가 올바르지 않아요. 처음부터 다시 불러와 주세요.");
	}

	private static String encode(String raw) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
	}

	private static String decode(String cursor) {
		try {
			return new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
		} catch (IllegalArgumentException e) {
			throw invalidCursor();
		}
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}

	/** 앞 48비트가 만든 밀리초인 UUIDv7 (RFC 9562). */
	private static UUID uuidV7(Instant now) {
		ThreadLocalRandom random = ThreadLocalRandom.current();
		long high = (now.toEpochMilli() << 16) | 0x7000L | (random.nextLong() & 0xFFFL);
		long low = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | Long.MIN_VALUE;
		return new UUID(high, low);
	}
}

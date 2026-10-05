package com.erp.identity.verification;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;

/**
 * 이메일 인증·비밀번호 재설정 코드 (AUTH-08·03): 6자리, 10분, 5회. 발송은 60초 간격, 보낸 시각부터 24시간에 10통.
 * 계정·용도마다 가장 최근 코드만 유효하다. 코드는 SHA-256(행 id + 코드)로만 저장한다.
 */
@Component
public class VerificationCodes {

	public enum Purpose {
		VERIFY_EMAIL, RESET_PASSWORD
	}

	public static final String RESEND_TOO_SOON = "RESEND_TOO_SOON";

	public static final String DAILY_SEND_LIMIT = "DAILY_SEND_LIMIT";

	public static final String CODE_MISMATCH = "CODE_MISMATCH";

	public static final String CODE_EXPIRED = "CODE_EXPIRED";

	public static final Duration TTL = Duration.ofMinutes(10);

	public static final Duration RESEND_INTERVAL = Duration.ofSeconds(60);

	static final Duration SEND_WINDOW = Duration.ofHours(24);

	static final int SENDS_PER_WINDOW = 10;

	static final int MAX_ATTEMPTS = 5;

	private final SecureRandom random = new SecureRandom();

	private final JdbcTemplate jdbc;

	private final TransactionTemplate separateTx;

	private final Clock clock;

	public VerificationCodes(JdbcTemplate jdbc, PlatformTransactionManager txManager, Clock clock) {
		this.jdbc = jdbc;
		this.separateTx = new TransactionTemplate(txManager);
		this.separateTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
		this.clock = clock;
	}

	/** 새로 발급한 코드. code는 메일로만 보내고 응답·로그에 넣지 않는다. */
	public record Issued(String code, Instant expiresAt, Instant resendAvailableAt) {

		@Override
		public String toString() {
			return "Issued[expiresAt=" + expiresAt + "]";
		}

	}

	/** 유효한 코드가 없으면 expiresAt·attemptsRemaining은 null. 지금 다시 받을 수 있으면 resendAvailableAt은 null. */
	public record Status(Instant expiresAt, Integer attemptsRemaining, Instant resendAvailableAt) {
	}

	/** 새 코드를 발급한다(이전 코드는 무효). 발송 한도를 넘으면 429. 호출한 트랜잭션 안에서 쓴다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public Issued issue(UUID userId, Purpose purpose) {
		// 같은 계정의 동시 발급을 줄 세운다. 그래야 60초·24시간 한도를 정확히 센다.
		jdbc.query("SELECT 1 FROM users WHERE id = ? FOR NO KEY UPDATE", rs -> null, userId);
		Instant now = clock.instant();
		Instant resendAt = nextSendAt(userId, purpose, now);
		if (resendAt != null) {
			throw sendLimited(now, resendAt, recentSends(userId, purpose, now).size() >= SENDS_PER_WINDOW);
		}
		UUID id = UUID.randomUUID();
		String code = "%06d".formatted(random.nextInt(1_000_000));
		jdbc.update("""
				INSERT INTO verification_codes (id, user_id, purpose, code_hash, expires_at, attempts, created_at)
				VALUES (?, ?, ?, ?, ?, 0, ?)""", id, userId, purpose.name(), hash(id, code), utc(now.plus(TTL)),
				utc(now));
		return new Issued(code, now.plus(TTL), now.plus(RESEND_INTERVAL));
	}

	@Transactional(readOnly = true)
	public Status status(UUID userId, Purpose purpose) {
		Instant now = clock.instant();
		record Latest(Instant expiresAt, int attempts) {
		}
		List<Latest> rows = jdbc.query("""
				SELECT expires_at, attempts FROM verification_codes WHERE user_id = ? AND purpose = ?
				ORDER BY created_at DESC LIMIT 1""",
				(rs, i) -> new Latest(rs.getObject("expires_at", OffsetDateTime.class).toInstant(), rs.getInt("attempts")),
				userId, purpose.name());
		Instant expiresAt = null;
		Integer remaining = null;
		if (!rows.isEmpty() && rows.get(0).expiresAt().isAfter(now) && rows.get(0).attempts() < MAX_ATTEMPTS) {
			expiresAt = rows.get(0).expiresAt();
			remaining = MAX_ATTEMPTS - rows.get(0).attempts();
		}
		return new Status(expiresAt, remaining, nextSendAt(userId, purpose, now));
	}

	/**
	 * 코드를 확인하고 맞으면 그 코드의 id를 돌려준다(쓰기 처리는 {@link #consume}). 틀리면 400 CODE_MISMATCH, 유효한 코드가 없으면 400 CODE_EXPIRED.
	 * 동시에 여러 번 넣어 5회 제한을 넘지 못하게, 비교 전에 시도 1회를 먼저 차감하고(맞으면 되돌린다) 별도 트랜잭션으로 바로 커밋한다.
	 * 그래서 호출한 트랜잭션이 나중에 롤백돼도 틀린 시도는 남는다. 호출 전에 이 코드 행을 잠그지 않아야 한다.
	 */
	public UUID check(UUID userId, Purpose purpose, String code) {
		Instant now = clock.instant();
		List<Map<String, Object>> claimed = separateTx.execute(tx -> jdbc.queryForList("""
				UPDATE verification_codes SET attempts = attempts + 1
				WHERE id = (SELECT id FROM verification_codes WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1)
				  AND attempts < ? AND expires_at > ?
				RETURNING id, code_hash, attempts""", userId, purpose.name(), MAX_ATTEMPTS, utc(now)));
		if (claimed == null || claimed.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, CODE_EXPIRED, "코드가 만료됐어요. 새 코드를 받아 주세요.");
		}
		UUID id = (UUID) claimed.get(0).get("id");
		int attempts = ((Number) claimed.get(0).get("attempts")).intValue();
		byte[] expected = ((String) claimed.get(0).get("code_hash")).getBytes(StandardCharsets.US_ASCII);
		if (MessageDigest.isEqual(expected, hash(id, code).getBytes(StandardCharsets.US_ASCII))) {
			separateTx.executeWithoutResult(
					tx -> jdbc.update("UPDATE verification_codes SET attempts = attempts - 1 WHERE id = ?", id));
			return id;
		}
		throw new ApiException(HttpStatus.BAD_REQUEST, CODE_MISMATCH, "코드가 맞지 않아요.", List.of(),
				Map.of("attemptsRemaining", MAX_ATTEMPTS - attempts));
	}

	/** 맞은 코드를 다시 쓸 수 없게 한다. 호출한 트랜잭션과 함께 커밋된다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public void consume(UUID codeId) {
		jdbc.update("UPDATE verification_codes SET expires_at = ? WHERE id = ?", utc(clock.instant()), codeId);
	}

	/** 지금 보낼 수 없으면 보낼 수 있게 되는 시각, 보낼 수 있으면 null. */
	private Instant nextSendAt(UUID userId, Purpose purpose, Instant now) {
		List<Instant> sends = recentSends(userId, purpose, now);
		if (sends.isEmpty()) {
			return null;
		}
		// 하루 한도가 먼저다. 한도에 닿았으면 60초 뒤가 아니라 한도가 풀리는 시각을 알려 준다.
		if (sends.size() >= SENDS_PER_WINDOW) {
			return sends.get(sends.size() - SENDS_PER_WINDOW).plus(SEND_WINDOW);
		}
		Instant afterInterval = sends.get(sends.size() - 1).plus(RESEND_INTERVAL);
		return afterInterval.isAfter(now) ? afterInterval : null;
	}

	/** 최근 24시간 발송 시각, 오래된 순. */
	private List<Instant> recentSends(UUID userId, Purpose purpose, Instant now) {
		return jdbc
			.queryForList("""
					SELECT created_at FROM verification_codes WHERE user_id = ? AND purpose = ? AND created_at > ?
					ORDER BY created_at""", OffsetDateTime.class, userId, purpose.name(), utc(now.minus(SEND_WINDOW)))
			.stream()
			.map(OffsetDateTime::toInstant)
			.toList();
	}

	private static ApiException sendLimited(Instant now, Instant availableAt, boolean daily) {
		long seconds = Math.max(1, (Duration.between(now, availableAt).toMillis() + 999) / 1000);
		return new ApiException(HttpStatus.TOO_MANY_REQUESTS, daily ? DAILY_SEND_LIMIT : RESEND_TOO_SOON,
				daily ? "오늘은 더 보낼 수 없어요. 내일 다시 시도해 주세요." : "잠시 후 다시 받을 수 있어요.", List.of(),
				Map.of(Problems.RETRY_AFTER_SECONDS, seconds));
	}

	static String hash(UUID id, String code) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256")
				.digest((id + ":" + code).getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private static OffsetDateTime utc(Instant instant) {
		return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
	}

}

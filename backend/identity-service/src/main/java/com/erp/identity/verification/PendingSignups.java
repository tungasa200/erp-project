package com.erp.identity.verification;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
import com.erp.identity.verification.VerificationCodes.Issued;
import com.erp.identity.verification.VerificationCodes.Purpose;

/**
 * 가입 대기 (D-220). 인증 코드를 확인하기 전 가입 신청을 pending_signups에 두고, 확인되면 호출한 쪽이 계정을 만든다.
 * 코드·발송 규칙은 {@link VerificationCodes}와 같다(D-64). 메일은 이메일 인증 메일(SCR-MAIL-01)을 커밋 뒤 보낸다.
 */
@Component
public class PendingSignups {

	private final SecureRandom random = new SecureRandom();

	private final JdbcTemplate jdbc;

	private final CodeMailSender mails;

	private final TransactionTemplate separateTx;

	private final Clock clock;

	public PendingSignups(JdbcTemplate jdbc, CodeMailSender mails, PlatformTransactionManager txManager, Clock clock) {
		this.jdbc = jdbc;
		this.mails = mails;
		this.separateTx = new TransactionTemplate(txManager);
		this.separateTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
		this.clock = clock;
	}

	/** 확인된 가입 신청. codeSalt는 {@link #consume}에서 그 사이 새 코드로 바뀌지 않았는지 확인하는 데 쓴다. */
	public record Confirmed(String passwordHash, UUID codeSalt) {
	}

	/**
	 * 가입 대기를 저장(같은 이메일이면 덮어씀)하고 새 코드를 커밋 뒤 메일로 보낸다. 발송 한도를 넘으면 429이고 아무것도 바꾸지 않는다.
	 */
	@Transactional(propagation = Propagation.MANDATORY)
	public Issued submit(String email, String passwordHash) {
		Instant now = clock.instant();
		UUID salt = UUID.randomUUID();
		String code = "%06d".formatted(random.nextInt(1_000_000));
		String hash = VerificationCodes.hash(salt, code);
		Instant expiresAt = now.plus(VerificationCodes.TTL);
		int inserted = jdbc.update("""
				INSERT INTO pending_signups (email, password_hash, code_salt, code_hash, expires_at, attempts, sent_at, created_at)
				VALUES (?, ?, ?, ?, ?, 0, ARRAY[?::timestamptz], ?) ON CONFLICT (email) DO NOTHING""", email,
				passwordHash, salt, hash, utc(expiresAt), utc(now), utc(now));
		if (inserted == 0) {
			// 같은 이메일의 동시 신청을 줄 세운다. 그래야 60초·24시간 한도를 정확히 센다.
			jdbc.query("SELECT 1 FROM pending_signups WHERE email = ? FOR UPDATE", rs -> null, email);
			List<Instant> sends = jdbc
				.queryForList("SELECT t FROM pending_signups, unnest(sent_at) t WHERE email = ? AND t > ? ORDER BY t",
						OffsetDateTime.class, email, utc(now.minus(VerificationCodes.SEND_WINDOW)))
				.stream()
				.map(OffsetDateTime::toInstant)
				.toList();
			Instant resendAt = VerificationCodes.nextSendAt(sends, now);
			if (resendAt != null) {
				throw VerificationCodes.sendLimited(now, resendAt, sends.size() >= VerificationCodes.SENDS_PER_WINDOW);
			}
			jdbc.update("""
					UPDATE pending_signups SET password_hash = ?, code_salt = ?, code_hash = ?, expires_at = ?, attempts = 0,
					  sent_at = array_append(ARRAY(SELECT t FROM unnest(sent_at) t WHERE t > ?), ?::timestamptz)
					WHERE email = ?""", passwordHash, salt, hash, utc(expiresAt),
					utc(now.minus(VerificationCodes.SEND_WINDOW)), utc(now), email);
		}
		mails.sendAfterCommit(null, email, Purpose.VERIFY_EMAIL, code);
		return new Issued(code, expiresAt, now.plus(VerificationCodes.RESEND_INTERVAL));
	}

	/**
	 * 코드를 확인한다. 틀리면 400 CODE_MISMATCH, 유효한 코드(또는 가입 대기)가 없으면 400 CODE_EXPIRED.
	 * {@link VerificationCodes#check}와 같이 시도 1회를 별도 트랜잭션으로 먼저 차감하고 맞으면 되돌린다.
	 */
	public Confirmed check(String email, String code) {
		Instant now = clock.instant();
		List<Map<String, Object>> claimed = separateTx.execute(tx -> jdbc.queryForList("""
				UPDATE pending_signups SET attempts = attempts + 1
				WHERE email = ? AND attempts < ? AND expires_at > ?
				RETURNING code_salt, code_hash, attempts, password_hash""", email, VerificationCodes.MAX_ATTEMPTS,
				utc(now)));
		if (claimed == null || claimed.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, VerificationCodes.CODE_EXPIRED, "코드가 만료됐어요. 새 코드를 받아 주세요.");
		}
		Map<String, Object> row = claimed.get(0);
		UUID salt = (UUID) row.get("code_salt");
		int attempts = ((Number) row.get("attempts")).intValue();
		byte[] expected = ((String) row.get("code_hash")).getBytes(StandardCharsets.US_ASCII);
		if (MessageDigest.isEqual(expected, VerificationCodes.hash(salt, code).getBytes(StandardCharsets.US_ASCII))) {
			separateTx.executeWithoutResult(tx -> jdbc
				.update("UPDATE pending_signups SET attempts = attempts - 1 WHERE email = ? AND code_salt = ?", email, salt));
			return new Confirmed((String) row.get("password_hash"), salt);
		}
		throw new ApiException(HttpStatus.BAD_REQUEST, VerificationCodes.CODE_MISMATCH, "코드가 맞지 않아요.", List.of(),
				Map.of("attemptsRemaining", VerificationCodes.MAX_ATTEMPTS - attempts));
	}

	/**
	 * 계정을 만든 트랜잭션 안에서 가입 대기를 지운다. 확인한 뒤 같은 이메일로 다시 신청해 코드가 바뀌었거나
	 * 동시에 확인해 이미 지워졌으면 400 CODE_EXPIRED(호출한 트랜잭션이 롤백돼 계정도 만들어지지 않는다).
	 */
	@Transactional(propagation = Propagation.MANDATORY)
	public void consume(String email, Confirmed confirmed) {
		if (jdbc.update("DELETE FROM pending_signups WHERE email = ? AND code_salt = ?", email,
				confirmed.codeSalt()) == 0) {
			throw new ApiException(HttpStatus.BAD_REQUEST, VerificationCodes.CODE_EXPIRED, "코드가 만료됐어요. 새 코드를 받아 주세요.");
		}
	}

	private static OffsetDateTime utc(Instant instant) {
		return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
	}

}

package com.erp.identity.auth;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.identity.user.UserCredential;
import com.erp.identity.verification.CodeMailSender;
import com.erp.identity.verification.IpSendLimiter;
import com.erp.identity.verification.VerificationCodes;
import com.erp.identity.verification.VerificationCodes.Issued;
import com.erp.identity.verification.VerificationCodes.Purpose;

/**
 * 비밀번호 재설정 (AUTH-03, P1-13). 코드로 메일 소유를 증명하므로, 저장하면 이메일 인증도 완료하고 모든 로그인 세션을 폐기한다.
 * 미인증 계정의 실제 이메일 주인이 계정을 되찾는 경로이기도 하다 (AUTH-08 이메일 선점 대응).
 */
@Service
public class PasswordResetService {

	private final JdbcTemplate jdbc;

	private final VerificationCodes codes;

	private final CodeMailSender mails;

	private final IpSendLimiter ipLimiter;

	private final PasswordEncoder passwordEncoder;

	private final Clock clock;

	public PasswordResetService(JdbcTemplate jdbc, VerificationCodes codes, CodeMailSender mails,
			IpSendLimiter ipLimiter, PasswordEncoder passwordEncoder, Clock clock) {
		this.jdbc = jdbc;
		this.codes = codes;
		this.mails = mails;
		this.ipLimiter = ipLimiter;
		this.passwordEncoder = passwordEncoder;
		this.clock = clock;
	}

	/** 가입 여부와 관계없이 같은 형식으로 답한다. 없는 이메일이면 메일을 보내지 않는다. */
	@Transactional
	public Issued request(String rawEmail, String clientIp) {
		ipLimiter.consume(clientIp);
		String email = SignupRequest.normalizeEmail(rawEmail);
		UUID userId = findUserId(email);
		if (userId == null) {
			Instant now = clock.instant();
			return new Issued(null, now.plus(VerificationCodes.TTL), now.plus(VerificationCodes.RESEND_INTERVAL));
		}
		Issued issued = codes.issue(userId, Purpose.RESET_PASSWORD);
		mails.sendAfterCommit(userId, email, Purpose.RESET_PASSWORD, issued.code());
		return issued;
	}

	/** 코드만 확인한다(쓰지 않음). */
	public void verify(String rawEmail, String code) {
		codes.check(requireUser(SignupRequest.normalizeEmail(rawEmail)), Purpose.RESET_PASSWORD, code);
	}

	/** 코드를 먼저 확인하고 비밀번호 규칙을 본다. 규칙 오류면 코드는 쓰지 않은 채로 남는다(롤백). */
	@Transactional
	public void confirm(String rawEmail, String code, String newPassword) {
		String email = SignupRequest.normalizeEmail(rawEmail);
		UUID userId = requireUser(email);
		UUID codeId = codes.check(userId, Purpose.RESET_PASSWORD, code);

		List<FieldErrorDetail> errors = PasswordRulesValidator.violations(newPassword, email)
			.stream()
			.map(c -> new FieldErrorDetail("newPassword", c, null))
			.toList();
		if (!errors.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.", errors,
					Map.of());
		}

		OffsetDateTime now = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
		jdbc.update("UPDATE user_credentials SET password_hash = ? WHERE provider = ? AND provider_subject = ?",
				passwordEncoder.encode(newPassword), UserCredential.Provider.PASSWORD.name(), userId.toString());
		// 메일 소유 증명 → 이메일 인증 완료. 본인 확인을 마쳤으므로 로그인 잠금도 푼다(AUTH-09).
		jdbc.update("""
				UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), failed_login_count = 0,
				  locked_until = NULL, version = version + 1, updated_at = ?
				WHERE id = ?""", now, now, userId);
		// 모든 기기 로그아웃. 이미 발급된 Access Token은 수명(10분) 동안 남는다 (D-17).
		jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
		codes.consume(codeId);
	}

	private UUID requireUser(String email) {
		UUID userId = findUserId(email);
		if (userId == null) {
			// 코드를 받을 수 없는 이메일이다. 발급한 적 없는 코드와 같게 답한다.
			throw new ApiException(HttpStatus.BAD_REQUEST, VerificationCodes.CODE_EXPIRED, "코드가 만료됐어요. 새 코드를 받아 주세요.");
		}
		return userId;
	}

	private UUID findUserId(String email) {
		List<UUID> ids = jdbc.queryForList("SELECT id FROM users WHERE email = ?", UUID.class, email);
		return ids.isEmpty() ? null : ids.get(0);
	}

}

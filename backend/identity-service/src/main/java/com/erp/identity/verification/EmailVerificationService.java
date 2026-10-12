package com.erp.identity.verification;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.erp.common.error.ApiException;
import com.erp.identity.user.MeController;
import com.erp.identity.verification.VerificationCodes.Issued;
import com.erp.identity.verification.VerificationCodes.Purpose;
import com.erp.identity.verification.VerificationCodes.Status;

/**
 * 이메일 인증 (AUTH-08, P1-12). D-220부터 새 가입은 가입 확인(PendingSignups)으로 인증을 마치므로,
 * 이 흐름은 그 전에 가입하고 인증하지 않은 계정용이다. 사용자가 코드를 받고 입력한다.
 * 인증 완료는 Profile 칸이 아니라 피드에 남기지 않는다. users는 SQL로 바꾸고 version을 함께 올린다.
 */
@Service
public class EmailVerificationService {

	public static final String EMAIL_ALREADY_VERIFIED = "EMAIL_ALREADY_VERIFIED";

	private final JdbcTemplate jdbc;

	private final VerificationCodes codes;

	private final CodeMailSender mails;

	private final IpSendLimiter ipLimiter;

	private final Clock clock;

	public EmailVerificationService(JdbcTemplate jdbc, VerificationCodes codes, CodeMailSender mails,
			IpSendLimiter ipLimiter, Clock clock) {
		this.jdbc = jdbc;
		this.codes = codes;
		this.mails = mails;
		this.ipLimiter = ipLimiter;
		this.clock = clock;
	}

	public record EmailState(String email, boolean verified) {
	}

	/** 호출한 트랜잭션 안에서 코드를 발급하고 커밋 뒤 메일로 보낸다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public Issued sendFirst(UUID userId, String email) {
		Issued issued = codes.issue(userId, Purpose.VERIFY_EMAIL);
		mails.sendAfterCommit(userId, email, Purpose.VERIFY_EMAIL, issued.code());
		return issued;
	}

	@Transactional
	public Issued send(UUID userId, String clientIp) {
		EmailState state = load(userId);
		if (state.verified()) {
			throw new ApiException(HttpStatus.CONFLICT, EMAIL_ALREADY_VERIFIED, "이미 인증된 이메일입니다.");
		}
		ipLimiter.consume(clientIp);
		return sendFirst(userId, state.email());
	}

	@Transactional(readOnly = true)
	public VerificationStatus status(UUID userId) {
		if (load(userId).verified()) {
			return new VerificationStatus(true, null);
		}
		return new VerificationStatus(false, codes.status(userId, Purpose.VERIFY_EMAIL));
	}

	public record VerificationStatus(boolean verified, Status code) {
	}

	/** 맞으면 인증 완료. 이미 인증된 사용자는 코드를 보지 않는다. */
	@Transactional
	public void confirm(UUID userId, String code) {
		if (load(userId).verified()) {
			return;
		}
		UUID codeId = codes.check(userId, Purpose.VERIFY_EMAIL, code);
		OffsetDateTime now = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
		jdbc.update("UPDATE users SET email_verified_at = ?, version = version + 1, updated_at = ? "
				+ "WHERE id = ? AND email_verified_at IS NULL", now, now, userId);
		codes.consume(codeId);
	}

	private EmailState load(UUID userId) {
		List<Map<String, Object>> rows = jdbc.queryForList("SELECT email, email_verified_at FROM users WHERE id = ?",
				userId);
		if (rows.isEmpty()) {
			// 서명이 맞는 토큰인데 사용자가 없으면 탈퇴한 경우다.
			throw new ApiException(HttpStatus.UNAUTHORIZED, MeController.USER_DELETED, "탈퇴한 사용자입니다.");
		}
		return new EmailState((String) rows.get(0).get("email"), rows.get(0).get("email_verified_at") != null);
	}

}

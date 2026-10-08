package com.erp.worklog.journal;

import com.erp.common.error.ApiException;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.user.DeletedUserInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * 파일 내보내기 전 이메일 인증 확인 (AUTH-08, D-109). 기억한 인증이 없으면 사용자 토큰으로 identity GET /api/users/me를 보고,
 * 인증은 되돌아가지 않으므로 true만 email_verified_user에 기억한다.
 */
@Component
class EmailVerification {

	private static final Logger log = LoggerFactory.getLogger(EmailVerification.class);

	private final JdbcClient jdbc;
	private final IdentityClient identity;
	private final Clock clock;

	EmailVerification(JdbcClient jdbc, IdentityClient identity, Clock clock) {
		this.jdbc = jdbc;
		this.identity = identity;
		this.clock = clock;
	}

	/** 인증했으면 그냥 돌아온다. 아니면 403 EMAIL_NOT_VERIFIED, 확인하지 못하면 503 IDENTITY_UNAVAILABLE. */
	void require(UUID userId, String userToken) {
		boolean remembered = jdbc.sql("SELECT EXISTS (SELECT 1 FROM email_verified_user WHERE user_id = ?)")
			.param(userId).query(Boolean.class).single();
		if (remembered) {
			return;
		}
		boolean verified;
		try {
			verified = identity.emailVerified(userToken);
		} catch (IdentityClient.UserDeletedException e) {
			throw DeletedUserInterceptor.userDeleted();
		} catch (IdentityClient.IdentityUnavailableException e) {
			log.warn("내보내기 이메일 인증 확인 중 identity 조회 실패: {}", e.toString());
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE",
					"이메일 인증 여부를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
		}
		if (!verified) {
			throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED", "파일로 내보내려면 이메일 인증이 필요해요.");
		}
		jdbc.sql("INSERT INTO email_verified_user (user_id, verified_at) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING")
			.params(userId, OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
			.update();
	}
}

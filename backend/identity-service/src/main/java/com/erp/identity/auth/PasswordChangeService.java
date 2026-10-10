package com.erp.identity.auth;

import java.util.ArrayList;
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
import com.erp.identity.user.MeController;
import com.erp.identity.user.UserCredential;

/**
 * 로그인 상태의 비밀번호 변경 (AUTH-07, P4-08). 확인 순서: 시도 제한 → 현재 비밀번호 → 새 비밀번호 규칙(D-38).
 * 성공하면 현재 기기의 세션만 남기고 다른 기기의 로그인 세션을 폐기한다.
 */
@Service
public class PasswordChangeService {

	public static final String CURRENT_PASSWORD_MISMATCH = "CURRENT_PASSWORD_MISMATCH";

	static final String PASSWORD_SAME_AS_CURRENT = "PASSWORD_SAME_AS_CURRENT";

	private final JdbcTemplate jdbc;

	private final PasswordEncoder passwordEncoder;

	private final PasswordChangeProtection protection;

	private final RefreshTokenService refreshTokens;

	public PasswordChangeService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder,
			PasswordChangeProtection protection, RefreshTokenService refreshTokens) {
		this.jdbc = jdbc;
		this.passwordEncoder = passwordEncoder;
		this.protection = protection;
		this.refreshTokens = refreshTokens;
	}

	/** @return 현재 기기의 로그인이 유지되면 true, 현재 기기를 가려낼 수 없어 모든 세션을 폐기했으면 false */
	@Transactional
	public boolean change(UUID userId, String rawRefreshToken, String currentPassword, String newPassword) {
		protection.rejectIfLocked(userId);
		List<Map<String, Object>> rows = jdbc.queryForList("""
				SELECT u.email, c.password_hash FROM users u
				LEFT JOIN user_credentials c ON c.provider = ? AND c.provider_subject = ?
				WHERE u.id = ?""", UserCredential.Provider.PASSWORD.name(), userId.toString(), userId);
		if (rows.isEmpty()) {
			throw new ApiException(HttpStatus.UNAUTHORIZED, MeController.USER_DELETED, "탈퇴한 사용자입니다.");
		}
		String email = (String) rows.get(0).get("email");
		String hash = (String) rows.get(0).get("password_hash");
		if (hash == null || !passwordEncoder.matches(currentPassword, hash)) {
			protection.recordFailure(userId);
			throw new ApiException(HttpStatus.BAD_REQUEST, CURRENT_PASSWORD_MISMATCH, "현재 비밀번호가 맞지 않습니다.",
					List.of(new FieldErrorDetail("currentPassword", CURRENT_PASSWORD_MISMATCH, null)), Map.of());
		}

		List<String> codes = new ArrayList<>(PasswordRulesValidator.violations(newPassword, email));
		if (newPassword.equals(currentPassword)) {
			codes.add(PASSWORD_SAME_AS_CURRENT);
		}
		if (!codes.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.",
					codes.stream().map(c -> new FieldErrorDetail("newPassword", c, null)).toList(), Map.of());
		}

		protection.reset(userId);
		jdbc.update("UPDATE user_credentials SET password_hash = ? WHERE provider = ? AND provider_subject = ?",
				passwordEncoder.encode(newPassword), UserCredential.Provider.PASSWORD.name(), userId.toString());
		// 다른 기기에서 이미 발급된 Access Token은 수명(10분) 동안 남는다 (D-17).
		return refreshTokens.keepOnlySession(userId, rawRefreshToken);
	}

}

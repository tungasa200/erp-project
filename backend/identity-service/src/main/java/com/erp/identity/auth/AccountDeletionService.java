package com.erp.identity.auth;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.identity.user.MeController;
import com.erp.identity.user.UserCredential;
import com.erp.identity.user.UserCredentialRepository;
import com.erp.identity.user.UserDeletionService;
import com.erp.identity.user.UserRepository;

/**
 * 회원 탈퇴 (AUTH-06, P4-05). 비밀번호를 다시 확인한 뒤 즉시 실제로 삭제한다 (D-49).
 * 틀린 횟수는 비밀번호 변경과 함께 센다(카드 20261011-0330): 탈취된 세션이 두 API로 나눠 추측하지 못하게 한다.
 */
@Service
public class AccountDeletionService {

	public static final String PASSWORD_MISMATCH = "PASSWORD_MISMATCH";

	private final UserRepository users;

	private final UserCredentialRepository credentials;

	private final PasswordEncoder passwordEncoder;

	private final PasswordChangeProtection protection;

	private final UserDeletionService deletion;

	public AccountDeletionService(UserRepository users, UserCredentialRepository credentials,
			PasswordEncoder passwordEncoder, PasswordChangeProtection protection, UserDeletionService deletion) {
		this.users = users;
		this.credentials = credentials;
		this.passwordEncoder = passwordEncoder;
		this.protection = protection;
		this.deletion = deletion;
	}

	public void delete(UUID userId, String password) {
		protection.rejectIfLocked(userId);
		if (!users.existsById(userId)) {
			throw new ApiException(HttpStatus.UNAUTHORIZED, MeController.USER_DELETED, "탈퇴한 사용자입니다.");
		}
		String hash = credentials.findByProviderAndProviderSubject(UserCredential.Provider.PASSWORD, userId.toString())
			.map(UserCredential::getPasswordHash)
			.orElse(null);
		if (hash == null || !passwordEncoder.matches(password, hash)) {
			protection.recordFailure(userId);
			throw new ApiException(HttpStatus.BAD_REQUEST, PASSWORD_MISMATCH, "비밀번호가 맞지 않습니다.",
					List.of(new FieldErrorDetail("password", PASSWORD_MISMATCH, null)), Map.of());
		}
		deletion.delete(userId);
		protection.reset(userId);
	}

}

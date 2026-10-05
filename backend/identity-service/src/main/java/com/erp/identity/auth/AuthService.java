package com.erp.identity.auth;

import java.time.Clock;
import java.time.Instant;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.erp.common.error.ApiException;
import com.erp.identity.feed.UserFeed;
import com.erp.identity.user.User;
import com.erp.identity.user.UserCredential;
import com.erp.identity.user.UserCredentialRepository;
import com.erp.identity.user.UserRepository;

/**
 * 가입·로그인 (AUTH-01, AUTH-02). 성공하면 새 로그인 세션의 Refresh Token 원문을 함께 돌려준다.
 */
@Service
public class AuthService {

	public static final String EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS";

	public static final String INVALID_CREDENTIALS = "INVALID_CREDENTIALS";

	private final UserRepository users;

	private final UserCredentialRepository credentials;

	private final RefreshTokenService refreshTokens;

	private final UserFeed feed;

	private final PasswordEncoder passwordEncoder;

	private final Clock clock;

	/** 없는 이메일도 BCrypt 비교를 한 번 해서 응답 시간으로 가입 여부를 알 수 없게 한다. */
	private final String dummyHash;

	public AuthService(UserRepository users, UserCredentialRepository credentials, RefreshTokenService refreshTokens,
			UserFeed feed, PasswordEncoder passwordEncoder, Clock clock) {
		this.users = users;
		this.credentials = credentials;
		this.refreshTokens = refreshTokens;
		this.feed = feed;
		this.passwordEncoder = passwordEncoder;
		this.clock = clock;
		this.dummyHash = passwordEncoder.encode("timing-equalizer-0");
	}

	public record Session(User user, String refreshToken) {
	}

	@Transactional
	public Session signUp(SignupRequest request) {
		if (users.existsByEmail(request.email())) {
			throw emailAlreadyExists();
		}
		Instant now = clock.instant();
		User user;
		try {
			user = users.saveAndFlush(User.signUp(request.email(), now));
		}
		catch (DataIntegrityViolationException ex) {
			throw emailAlreadyExists(); // 같은 이메일 동시 가입
		}
		credentials.save(UserCredential.password(user.getId(), passwordEncoder.encode(request.password()), now));
		feed.created(user.getId(), user.profile(), now);
		return new Session(user, refreshTokens.startSession(user.getId()));
	}

	/** 잠금·지연(AUTH-09)은 P1-14에서 추가한다. */
	@Transactional
	public Session login(LoginRequest request) {
		User user = users.findByEmail(request.email()).orElse(null);
		String hash = user == null ? null
				: credentials
					.findByProviderAndProviderSubject(UserCredential.Provider.PASSWORD, user.getId().toString())
					.map(UserCredential::getPasswordHash)
					.orElse(null);
		boolean matches = passwordEncoder.matches(request.password(), hash != null ? hash : dummyHash);
		if (hash == null || !matches) {
			throw new ApiException(HttpStatus.UNAUTHORIZED, INVALID_CREDENTIALS, "이메일 또는 비밀번호가 맞지 않습니다.");
		}
		return new Session(user, refreshTokens.startSession(user.getId()));
	}

	private static ApiException emailAlreadyExists() {
		return new ApiException(HttpStatus.CONFLICT, EMAIL_ALREADY_EXISTS, "이미 가입된 이메일입니다.");
	}

}

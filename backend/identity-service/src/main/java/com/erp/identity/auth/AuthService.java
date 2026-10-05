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
import com.erp.identity.verification.EmailVerificationService;

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

	private final LoginProtection loginProtection;

	private final IpLoginLimiter ipLimiter;

	private final EmailVerificationService emailVerification;

	private final Clock clock;

	/** 없는 이메일도 BCrypt 비교를 한 번 해서 응답 시간으로 가입 여부를 알 수 없게 한다. */
	private final String dummyHash;

	public AuthService(UserRepository users, UserCredentialRepository credentials, RefreshTokenService refreshTokens,
			UserFeed feed, PasswordEncoder passwordEncoder, LoginProtection loginProtection, IpLoginLimiter ipLimiter,
			EmailVerificationService emailVerification, Clock clock) {
		this.users = users;
		this.credentials = credentials;
		this.refreshTokens = refreshTokens;
		this.feed = feed;
		this.passwordEncoder = passwordEncoder;
		this.loginProtection = loginProtection;
		this.ipLimiter = ipLimiter;
		this.emailVerification = emailVerification;
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
		// 먼저 사용, 나중에 인증 (D-20): 가입을 막지 않고 첫 인증번호를 커밋 뒤 보낸다. 발송 실패는 가입에 영향이 없다.
		emailVerification.sendFirst(user.getId(), user.getEmail());
		return new Session(user, refreshTokens.startSession(user.getId()));
	}

	/**
	 * 트랜잭션을 열지 않는다: 실패 기록은 401을 던져도 남아야 하고, 실패 지연(AUTH-09) 동안 DB 연결을 잡지 않게 한다.
	 * 저장소·세션 시작은 각자 트랜잭션으로 실행된다.
	 */
	public Session login(LoginRequest request, String clientIp) {
		ipLimiter.rejectIfLimited(clientIp);
		User user = users.findByEmail(request.email()).orElse(null);
		if (user != null) {
			loginProtection.rejectIfLocked(user.getLockedUntil());
		}
		String hash = user == null ? null
				: credentials
					.findByProviderAndProviderSubject(UserCredential.Provider.PASSWORD, user.getId().toString())
					.map(UserCredential::getPasswordHash)
					.orElse(null);
		boolean matches = passwordEncoder.matches(request.password(), hash != null ? hash : dummyHash);
		if (hash == null || !matches) {
			ipLimiter.recordFailure(clientIp); // 없는 이메일도 센다
			if (user != null) {
				loginProtection.recordFailure(user.getId());
			}
			throw new ApiException(HttpStatus.UNAUTHORIZED, INVALID_CREDENTIALS, "이메일 또는 비밀번호가 맞지 않습니다.");
		}
		loginProtection.reset(user.getId());
		return new Session(user, refreshTokens.startSession(user.getId()));
	}

	private static ApiException emailAlreadyExists() {
		return new ApiException(HttpStatus.CONFLICT, EMAIL_ALREADY_EXISTS, "이미 가입된 이메일입니다.");
	}

}

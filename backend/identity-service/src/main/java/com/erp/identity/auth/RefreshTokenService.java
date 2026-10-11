package com.erp.identity.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Refresh Token rotation·재사용 탐지·30초 유예 (AUTH-02, D-17, D-46).
 * 실패해도 family 폐기는 커밋되어야 하므로 예외 대신 결과 값으로 돌려준다.
 */
@Service
public class RefreshTokenService {

	public static final Duration TTL = Duration.ofDays(14);

	/** 여러 탭이 거의 동시에 갱신할 때 직전 토큰을 탈취로 보지 않는 시간. */
	static final Duration GRACE = Duration.ofSeconds(30);

	private static final SecureRandom RANDOM = new SecureRandom();

	private final RefreshTokenRepository tokens;

	private final Clock clock;

	public RefreshTokenService(RefreshTokenRepository tokens, Clock clock) {
		this.tokens = tokens;
		this.clock = clock;
	}

	/** 갱신 결과. refreshToken은 정상 rotation일 때만 있다(유예면 null이라 쿠키를 보내지 않는다). */
	public sealed interface Outcome {

		record Refreshed(UUID userId, String refreshToken) implements Outcome {
		}

		record Invalid() implements Outcome {
		}

	}

	/** 로그인·가입: 새 family(로그인 세션)를 시작하고 원문 토큰을 돌려준다. */
	@Transactional
	public String startSession(UUID userId) {
		return issue(userId, UUID.randomUUID(), clock.instant());
	}

	@Transactional
	public Outcome refresh(String rawToken) {
		if (rawToken == null || rawToken.isBlank()) {
			return new Outcome.Invalid();
		}
		RefreshToken token = tokens.findByTokenHashForUpdate(hash(rawToken)).orElse(null);
		if (token == null) {
			return new Outcome.Invalid();
		}
		Instant now = clock.instant();
		if (token.getRevokedAt() == null) {
			if (token.isExpired(now)) {
				return new Outcome.Invalid();
			}
			token.revoke(now);
			return new Outcome.Refreshed(token.getUserId(), issue(token.getUserId(), token.getFamilyId(), now));
		}
		// 방금 교체된 토큰이고 세션이 살아 있으면(로그아웃·재사용 탐지로 폐기되지 않음) 다른 탭의 동시 갱신으로 본다.
		boolean justRotated = token.getRevokedAt().plus(GRACE).isAfter(now);
		if (justRotated && tokens.existsByFamilyIdAndRevokedAtIsNull(token.getFamilyId())) {
			return new Outcome.Refreshed(token.getUserId(), null);
		}
		tokens.revokeFamily(token.getFamilyId(), now);
		return new Outcome.Invalid();
	}

	/** 로그아웃: 쿠키의 family를 폐기한다. 없거나 이미 폐기된 토큰이면 아무것도 하지 않는다. */
	@Transactional
	public void endSession(String rawToken) {
		if (rawToken == null || rawToken.isBlank()) {
			return;
		}
		tokens.findByTokenHashForUpdate(hash(rawToken))
			.ifPresent(token -> tokens.revokeFamily(token.getFamilyId(), clock.instant()));
	}

	/**
	 * 비밀번호 변경 (AUTH-07, P4-08): 요청의 refresh 토큰이 이 사용자의 살아 있는 세션이면 그 세션만 남기고 나머지를 폐기한다.
	 * 토큰이 없거나 유효하지 않으면 현재 기기를 가려낼 수 없으므로 모든 세션을 폐기하고 false를 돌려준다.
	 * 방금 교체된 토큰(30초 유예)도 같은 세션으로 본다. 다른 탭이 먼저 갱신한 경우다.
	 */
	@Transactional
	public boolean keepOnlySession(UUID userId, String rawToken) {
		Instant now = clock.instant();
		RefreshToken token = rawToken == null || rawToken.isBlank() ? null
				: tokens.findByTokenHashForUpdate(hash(rawToken)).orElse(null);
		boolean current = token != null && token.getUserId().equals(userId) && !token.isExpired(now)
				&& (token.getRevokedAt() == null || token.getRevokedAt().plus(GRACE).isAfter(now))
				&& tokens.existsByFamilyIdAndRevokedAtIsNull(token.getFamilyId());
		if (current) {
			tokens.revokeOtherFamilies(userId, token.getFamilyId(), now);
		}
		else {
			tokens.revokeAllOfUser(userId, now);
		}
		return current;
	}

	private String issue(UUID userId, UUID familyId, Instant now) {
		byte[] bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
		tokens.save(new RefreshToken(userId, familyId, hash(raw), now.plus(TTL), now));
		return raw;
	}

	static String hash(String rawToken) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(rawToken.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}

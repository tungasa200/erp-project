package com.erp.identity.auth;

import java.time.Duration;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;

import com.erp.identity.token.AccessTokenIssuer;

/**
 * 인증 쿠키 2종 (D-16, contracts/identity.yaml). Domain을 지정하지 않는다(host-only).
 * Secure는 항상 켠다. 브라우저는 http://localhost도 안전한 출처로 보아 로컬에서도 저장한다.
 */
final class AuthCookies {

	static final String ACCESS = "access_token";

	static final String REFRESH = "refresh_token";

	private AuthCookies() {
	}

	static void setAccess(HttpHeaders headers, String token) {
		headers.add(HttpHeaders.SET_COOKIE, cookie(ACCESS, token, "/api", AccessTokenIssuer.TTL));
	}

	static void setRefresh(HttpHeaders headers, String token) {
		headers.add(HttpHeaders.SET_COOKIE, cookie(REFRESH, token, "/api/auth", RefreshTokenService.TTL));
	}

	static HttpHeaders clear() {
		HttpHeaders headers = new HttpHeaders();
		headers.add(HttpHeaders.SET_COOKIE, cookie(ACCESS, "", "/api", Duration.ZERO));
		headers.add(HttpHeaders.SET_COOKIE, cookie(REFRESH, "", "/api/auth", Duration.ZERO));
		return headers;
	}

	private static String cookie(String name, String value, String path, Duration maxAge) {
		return ResponseCookie.from(name, value)
			.httpOnly(true)
			.secure(true)
			.sameSite("Strict")
			.path(path)
			.maxAge(maxAge)
			.build()
			.toString();
	}

}

package com.erp.gateway;

import org.springframework.core.Ordered;
import org.springframework.http.HttpCookie;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Locale;

/**
 * 외부에서 온 Authorization·X-User-* 헤더를 지우고 (NFR-03),
 * 인증이 필요한 경로는 access_token 쿠키를 Authorization: Bearer로 옮긴다 (P0-04).
 * Spring Security보다 먼저 실행되어야 외부 Authorization이 검증에 쓰이지 않는다.
 * /api/auth/**는 Bearer를 붙이지 않는다: identity가 쿠키를 직접 다룬다 (backend1과 합의).
 */
@Component
public class HeaderSanitizingFilter implements WebFilter, Ordered {

	static final String ACCESS_TOKEN_COOKIE = "access_token";

	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE + 10;
	}

	@Override
	public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
		HttpCookie accessToken = exchange.getRequest().getCookies().getFirst(ACCESS_TOKEN_COOKIE);
		boolean forwardBearer = requiresUserToken(exchange.getRequest().getPath().value()) && accessToken != null;
		var request = exchange.getRequest().mutate().headers(headers -> {
			headers.remove(HttpHeaders.AUTHORIZATION);
			List<String> userHeaders = headers.headerNames().stream()
					.filter(name -> name.toLowerCase(Locale.ROOT).startsWith("x-user-"))
					.toList();
			userHeaders.forEach(headers::remove);
			if (forwardBearer) {
				headers.setBearerAuth(accessToken.getValue());
			}
		}).build();
		return chain.filter(exchange.mutate().request(request).build());
	}

	static boolean requiresUserToken(String path) {
		return path.equals("/api/users/me") || path.startsWith("/api/users/me/")
				|| path.equals("/api/worklog") || path.startsWith("/api/worklog/");
	}
}

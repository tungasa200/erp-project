package com.erp.gateway;

import org.springframework.core.Ordered;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Vercel을 거치지 않은 직접 접근을 막는다 (P0-09). Vercel은 /api/* 프록시 요청에 X-Origin-Secret을 덮어써서 붙인다.
 * 값이 맞지 않으면 Gateway가 있다는 것도 드러내지 않도록 본문 없는 404로 응답한다.
 * 확인한 헤더는 지우고 전달한다. Railway 헬스체크는 Vercel을 거치지 않으므로 /actuator/health는 검사하지 않는다.
 */
@Component
public class OriginSecretFilter implements WebFilter, Ordered {

	static final String HEADER = "X-Origin-Secret";

	private final byte[] secret;

	public OriginSecretFilter(GatewayProperties props, Environment env) {
		String value = props.originSecret();
		if (value == null || value.isBlank()) {
			// 운영에서 비밀값이 빠지면 차단이 조용히 꺼지므로 기동을 막는다
			if (env.matchesProfiles("prod")) {
				throw new IllegalStateException("prod 프로필에는 ORIGIN_SECRET이 필요합니다.");
			}
			this.secret = null;
		} else {
			this.secret = value.getBytes(StandardCharsets.UTF_8);
		}
	}

	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE + 10;
	}

	@Override
	public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
		if (secret == null || exchange.getRequest().getPath().value().startsWith("/actuator/health")) {
			return chain.filter(exchange);
		}
		String given = exchange.getRequest().getHeaders().getFirst(HEADER);
		if (given == null || !MessageDigest.isEqual(secret, given.getBytes(StandardCharsets.UTF_8))) {
			exchange.getResponse().setStatusCode(HttpStatus.NOT_FOUND);
			return exchange.getResponse().setComplete();
		}
		// 내부 서비스로는 넘기지 않는다 (로그에 남지 않게)
		var request = exchange.getRequest().mutate().headers(h -> h.remove(HEADER)).build();
		return chain.filter(exchange.mutate().request(request).build());
	}
}

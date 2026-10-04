package com.erp.gateway;

import org.springframework.core.Ordered;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.Set;

/**
 * 쓰기 요청(POST·PUT·PATCH·DELETE)은 Origin이 허용 목록에 있을 때만 통과시킨다 (NFR-02, NFR-14).
 * Origin이 없는 쓰기 요청도 거부한다. 인증 쿠키의 CSRF 방어가 SameSite=Strict와 이 검사에 의존한다.
 */
@Component
public class OriginCheckFilter implements WebFilter, Ordered {

	private static final Set<HttpMethod> WRITE_METHODS = Set.of(HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE);

	private final Set<String> allowedOrigins;

	public OriginCheckFilter(GatewayProperties props) {
		this.allowedOrigins = Set.copyOf(props.allowedOrigins());
	}

	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE + 20;
	}

	@Override
	public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
		if (WRITE_METHODS.contains(exchange.getRequest().getMethod())) {
			String origin = exchange.getRequest().getHeaders().getOrigin();
			if (origin == null || !allowedOrigins.contains(origin)) {
				return Problems.write(exchange, HttpStatus.FORBIDDEN, "ORIGIN_REJECTED", "허용되지 않은 출처의 요청입니다.");
			}
		}
		return chain.filter(exchange);
	}
}

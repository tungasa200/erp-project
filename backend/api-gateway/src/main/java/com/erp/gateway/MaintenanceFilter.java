package com.erp.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;

/**
 * 점검 모드 (P4-12, D-48). MAINTENANCE_MODE=true면 /api/** 전체에 503 + code=MAINTENANCE를 준다.
 * MAINTENANCE_UNTIL(UTC ISO-8601)이 지금보다 뒤면 남은 초(올림)를 Retry-After로 준다.
 * 비밀 헤더 검사 뒤, Origin·인증 검사 앞에 둔다: 직접 접근은 점검 중에도 404이고, 점검 중에는 로그인 여부와 관계없이 503이다.
 * /actuator/health는 /api 밖이라 그대로 응답한다(배포 헬스체크).
 */
@Component
public class MaintenanceFilter implements WebFilter, Ordered {

	private static final Logger log = LoggerFactory.getLogger(MaintenanceFilter.class);

	private final boolean enabled;
	private final Instant until;
	private final Clock clock;

	@Autowired
	public MaintenanceFilter(@Value("${gateway.maintenance-mode:false}") boolean enabled,
			@Value("${gateway.maintenance-until:}") String until) {
		this(enabled, until, Clock.systemUTC());
	}

	MaintenanceFilter(boolean enabled, String until, Clock clock) {
		this.enabled = enabled;
		this.until = parse(until);
		this.clock = clock;
		if (enabled) {
			log.warn("점검 모드가 켜져 있다 (종료 예상 {})", this.until == null ? "없음" : this.until);
		}
	}

	private static Instant parse(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return Instant.parse(value.trim());
		} catch (DateTimeParseException e) {
			log.warn("MAINTENANCE_UNTIL을 해석할 수 없어 Retry-After를 보내지 않는다: {}", value);
			return null;
		}
	}

	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE + 15;
	}

	@Override
	public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
		String path = exchange.getRequest().getPath().value();
		if (!enabled || !(path.equals("/api") || path.startsWith("/api/"))) {
			return chain.filter(exchange);
		}
		if (until != null) {
			Duration left = Duration.between(clock.instant(), until);
			if (!left.isNegative() && !left.isZero()) {
				long seconds = left.getSeconds() + (left.getNano() > 0 ? 1 : 0);
				exchange.getResponse().getHeaders().set("Retry-After", Long.toString(seconds));
			}
		}
		return Problems.write(exchange, HttpStatus.SERVICE_UNAVAILABLE, "MAINTENANCE", "서비스 점검 중입니다.");
	}
}

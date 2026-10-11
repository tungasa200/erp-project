package com.erp.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

class MaintenanceFilterTest {

	static final Clock NOW = Clock.fixed(Instant.parse("2026-11-01T06:00:00Z"), ZoneOffset.UTC);

	final AtomicBoolean passed = new AtomicBoolean();
	final WebFilterChain chain = exchange -> {
		passed.set(true);
		return Mono.empty();
	};

	MockServerWebExchange run(MaintenanceFilter filter, String path) {
		var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(path));
		filter.filter(exchange, chain).block();
		return exchange;
	}

	@Test
	void offPassesEverything() {
		run(new MaintenanceFilter(false, "", NOW), "/api/worklog/me");
		assertThat(passed).isTrue();
	}

	@Test
	void onRejectsApiWith503MaintenanceAndRetryAfterRoundedUp() {
		var exchange = run(new MaintenanceFilter(true, "2026-11-01T06:30:00.5Z", NOW), "/api/auth/login");

		assertThat(passed).isFalse();
		assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
		assertThat(exchange.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("1801");
		assertThat(exchange.getResponse().getBodyAsString().block()).contains("\"code\":\"MAINTENANCE\"");
	}

	@Test
	void retryAfterOmittedWhenUntilMissingPastOrInvalid() {
		for (String until : new String[] { "", "2026-11-01T05:00:00Z", "내일 오후" }) {
			var exchange = run(new MaintenanceFilter(true, until, NOW), "/api/worklog/me");

			assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
			assertThat(exchange.getResponse().getHeaders().containsHeader("Retry-After")).isFalse();
		}
	}

	@Test
	void healthCheckAndNonApiPathsAreNotAffected() {
		run(new MaintenanceFilter(true, "", NOW), "/actuator/health/readiness");
		assertThat(passed.getAndSet(false)).isTrue();

		run(new MaintenanceFilter(true, "", NOW), "/apix");
		assertThat(passed).isTrue();
	}
}

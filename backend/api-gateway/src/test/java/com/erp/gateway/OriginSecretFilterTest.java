package com.erp.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OriginSecretFilterTest {

	final AtomicReference<ServerWebExchange> passed = new AtomicReference<>();
	final WebFilterChain chain = exchange -> {
		passed.set(exchange);
		return Mono.empty();
	};

	@Test
	void matchingSecretPassesAndIsNotForwarded() {
		var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/worklog/me").header("X-Origin-Secret", "s3cret"));

		filter("s3cret").filter(exchange, chain).block();

		assertThat(passed.get()).isNotNull();
		assertThat(passed.get().getRequest().getHeaders().containsHeader("X-Origin-Secret")).isFalse();
	}

	@Test
	void missingOrWrongSecretIs404WithoutReachingRoutes() {
		for (var request : List.of(MockServerHttpRequest.get("/api/worklog/me"),
				MockServerHttpRequest.get("/api/worklog/me").header("X-Origin-Secret", "guess"))) {
			var exchange = MockServerWebExchange.from(request);

			filter("s3cret").filter(exchange, chain).block();

			assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
			assertThat(passed.get()).isNull();
		}
	}

	@Test
	void healthCheckAndUnsetSecretAreNotChecked() {
		filter("s3cret").filter(MockServerWebExchange.from(MockServerHttpRequest.get("/actuator/health/readiness")), chain).block();
		assertThat(passed.getAndSet(null)).isNotNull();

		filter("").filter(MockServerWebExchange.from(MockServerHttpRequest.get("/api/worklog/me")), chain).block();
		assertThat(passed.get()).isNotNull();
	}

	@Test
	void prodWithoutSecretFailsToStart() {
		var prod = new MockEnvironment();
		prod.setActiveProfiles("prod");

		assertThatThrownBy(() -> new OriginSecretFilter(properties(""), prod)).isInstanceOf(IllegalStateException.class);
	}

	private static OriginSecretFilter filter(String secret) {
		return new OriginSecretFilter(properties(secret), new MockEnvironment());
	}

	private static GatewayProperties properties(String secret) {
		return new GatewayProperties(null, null, null, List.of(), secret);
	}
}

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

	@Test
	void vercelClientIpIsForwardedAndExternalValueReplaced() {
		var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/auth/login")
				.header("X-Origin-Secret", "s3cret")
				.header("X-Client-Ip", "6.6.6.6")
				.header("x-vercel-forwarded-for", "203.0.113.7")
				.header("x-real-ip", "198.51.100.1"));

		filter("s3cret").filter(exchange, chain).block();

		assertThat(passed.get().getRequest().getHeaders().get("X-Client-Ip")).containsExactly("203.0.113.7");
	}

	@Test
	void fallsBackToRealIpAndOmitsHeaderWhenNoValidIp() {
		var realIp = MockServerWebExchange.from(MockServerHttpRequest.get("/api/auth/login")
				.header("X-Origin-Secret", "s3cret")
				.header("x-vercel-forwarded-for", "not-an-ip")
				.header("x-real-ip", "2001:db8::1"));
		filter("s3cret").filter(realIp, chain).block();
		assertThat(passed.getAndSet(null).getRequest().getHeaders().getFirst("X-Client-Ip")).isEqualTo("2001:db8:0:0:0:0:0:1");

		// Vercel 헤더가 없으면 외부 값도 Gateway 주소도 넣지 않는다
		var none = MockServerWebExchange.from(MockServerHttpRequest.get("/api/auth/login")
				.header("X-Origin-Secret", "s3cret")
				.header("X-Client-Ip", "6.6.6.6"));
		filter("s3cret").filter(none, chain).block();
		assertThat(passed.get().getRequest().getHeaders().containsHeader("X-Client-Ip")).isFalse();
	}

	@Test
	void clientIpIsNotTrustedWithoutSecretCheck() {
		filter("s3cret").filter(MockServerWebExchange.from(MockServerHttpRequest.get("/actuator/health")
				.header("X-Client-Ip", "6.6.6.6").header("x-real-ip", "1.2.3.4")), chain).block();
		assertThat(passed.getAndSet(null).getRequest().getHeaders().containsHeader("X-Client-Ip")).isFalse();

		filter("").filter(MockServerWebExchange.from(MockServerHttpRequest.get("/api/auth/login")
				.header("X-Client-Ip", "6.6.6.6").header("x-real-ip", "1.2.3.4")), chain).block();
		assertThat(passed.get().getRequest().getHeaders().containsHeader("X-Client-Ip")).isFalse();
	}

	@Test
	void parseAcceptsOnlyIpLiterals() {
		assertThat(ClientIp.parse("203.0.113.7, 10.0.0.1")).isEqualTo("203.0.113.7");
		assertThat(ClientIp.parse(" ::1 ")).isEqualTo("0:0:0:0:0:0:0:1");
		assertThat(ClientIp.parse("256.1.1.1")).isNull();
		assertThat(ClientIp.parse("example.com")).isNull();
		assertThat(ClientIp.parse("1.2.3")).isNull();
		assertThat(ClientIp.parse("")).isNull();
	}

	private static OriginSecretFilter filter(String secret) {
		return new OriginSecretFilter(properties(secret), new MockEnvironment());
	}

	private static GatewayProperties properties(String secret) {
		return new GatewayProperties(null, null, null, List.of(), secret);
	}
}

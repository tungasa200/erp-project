package com.erp.gateway;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 Gateway를 띄우고 JDK HttpServer를 내부 서비스 대역으로 써서
 * 라우팅·헤더 정리·쿠키→Bearer·Origin 검사·traceId를 확인한다 (P0-04).
 * TODO: common testFixtures(com.erp.common.test)의 키·토큰 유틸이 생기면 키 생성을 그것으로 바꾼다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTracing // 테스트에서는 추적이 기본으로 꺼져 있어 traceId가 비어 있다
class GatewayRoutingTest {

	static final KeyPair KEYS = generateKeys();
	static final String ORIGIN = "http://localhost:5173";
	static final AtomicReference<Headers> lastDownstreamHeaders = new AtomicReference<>();
	static final HttpServer downstream = startDownstream();

	@LocalServerPort
	int port;

	WebTestClient client;

	@DynamicPropertySource
	static void routes(DynamicPropertyRegistry registry) {
		String uri = "http://localhost:" + downstream.getAddress().getPort();
		registry.add("IDENTITY_URI", () -> uri);
		registry.add("WORKLOG_URI", () -> uri);
		registry.add("ALLOWED_ORIGINS", () -> ORIGIN);
	}

	@AfterAll
	static void stopDownstream() {
		downstream.stop(0);
	}

	@BeforeEach
	void setUp() {
		lastDownstreamHeaders.set(null);
		client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
	}

	@Test
	void worklogRequestCarriesCookieTokenAsBearer() {
		String token = token("erp-api");
		client.get().uri("/api/worklog/me")
				.cookie("access_token", token)
				.header("X-User-Id", "attacker")
				.exchange()
				.expectStatus().isOk()
				.expectHeader().exists(TraceIdFilter.HEADER)
				// Vercel은 외부 rewrite 응답을 upstream Cache-Control대로 캐시하므로 인증 응답은 no-store여야 한다 (P0-09)
				.expectHeader().value("Cache-Control", v -> assertThat(v).contains("no-store"));

		Headers forwarded = lastDownstreamHeaders.get();
		assertThat(forwarded.getFirst("Authorization")).isEqualTo("Bearer " + token);
		assertThat(forwarded.containsKey("X-User-Id")).isFalse();
		assertThat(forwarded.getFirst("traceparent")).isNotBlank();
	}

	@Test
	void traceIdHeaderMatchesForwardedTraceparent() {
		var result = client.get().uri("/api/worklog/me").cookie("access_token", token("erp-api"))
				.exchange().expectStatus().isOk().returnResult(String.class);

		String traceId = result.getResponseHeaders().getFirst(TraceIdFilter.HEADER);
		// traceparent = 00-<traceId>-<spanId>-<flags>
		assertThat(lastDownstreamHeaders.get().getFirst("traceparent").split("-")[1]).isEqualTo(traceId);
	}

	@Test
	void externalAuthorizationHeaderIsIgnored() {
		client.get().uri("/api/worklog/me")
				.header("Authorization", "Bearer " + token("erp-api"))
				.exchange()
				.expectStatus().isUnauthorized()
				.expectHeader().contentType(MediaType.APPLICATION_PROBLEM_JSON)
				.expectBody().jsonPath("$.code").isEqualTo("UNAUTHENTICATED")
				.jsonPath("$.traceId").isNotEmpty();
		assertThat(lastDownstreamHeaders.get()).isNull();
	}

	@Test
	void serviceTokenIsRejectedOnUserRoutes() {
		client.get().uri("/api/users/me").cookie("access_token", token("erp-internal"))
				.exchange()
				.expectStatus().isUnauthorized();
	}

	@Test
	void authRoutesPassThroughWithoutBearer() {
		client.post().uri("/api/auth/refresh")
				.header("Origin", ORIGIN)
				.header("Authorization", "Bearer forged")
				.cookie("access_token", "expired-token")
				.cookie("refresh_token", "r")
				.exchange()
				.expectStatus().isOk();

		Headers forwarded = lastDownstreamHeaders.get();
		assertThat(forwarded.containsKey("Authorization")).isFalse();
		assertThat(forwarded.getFirst("Cookie")).contains("refresh_token=r");
	}

	@Test
	void writeWithForeignOriginIsRejected() {
		client.post().uri("/api/auth/login").header("Origin", "https://evil.example")
				.exchange()
				.expectStatus().isForbidden()
				.expectBody().jsonPath("$.code").isEqualTo("ORIGIN_REJECTED");
		assertThat(lastDownstreamHeaders.get()).isNull();
	}

	@Test
	void writeWithoutOriginIsRejected() {
		client.post().uri("/api/auth/login").exchange().expectStatus().isForbidden();
	}

	@Test
	void clientErrorsAreHandledByGatewayWithoutLoginButStillOriginChecked() {
		client.post().uri("/api/client-errors").header("Origin", ORIGIN).header("Content-Type", "application/json")
				.bodyValue("{\"message\":\"boom\"}")
				.exchange().expectStatus().isNoContent();
		client.post().uri("/api/client-errors").header("Content-Type", "application/json")
				.bodyValue("{\"message\":\"boom\"}")
				.exchange().expectStatus().isForbidden();
		assertThat(lastDownstreamHeaders.get()).isNull();
	}

	@Test
	void internalAndWellKnownPathsAreNotRouted() {
		client.get().uri("/internal/user-events?after=0").exchange().expectStatus().isEqualTo(HttpStatus.NOT_FOUND);
		client.get().uri("/.well-known/jwks.json").exchange().expectStatus().isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(lastDownstreamHeaders.get()).isNull();
	}

	private static String token(String audience) {
		try {
			Instant now = Instant.now();
			JWTClaimsSet claims = new JWTClaimsSet.Builder()
					.issuer("erp-identity")
					.subject(UUID.randomUUID().toString())
					.audience(audience)
					.issueTime(Date.from(now))
					.expirationTime(Date.from(now.plusSeconds(600)))
					.build();
			SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test").build(), claims);
			jwt.sign(new RSASSASigner(KEYS.getPrivate()));
			return jwt.serialize();
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	private static KeyPair generateKeys() {
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			return generator.generateKeyPair();
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	private static HttpServer startDownstream() {
		try {
			HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
			server.createContext("/", exchange -> {
				lastDownstreamHeaders.set(exchange.getRequestHeaders());
				exchange.sendResponseHeaders(200, -1);
				exchange.close();
			});
			server.start();
			return server;
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}

	@TestConfiguration
	static class TestKeys {
		/** JWKS 조회 대신 테스트 공개키로 검증한다. 검증 규칙은 운영과 같은 것을 쓴다. */
		@Bean
		@Primary
		ReactiveJwtDecoder testJwtDecoder(GatewayProperties props) {
			NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withPublicKey((RSAPublicKey) KEYS.getPublic()).build();
			decoder.setJwtValidator(SecurityConfig.userTokenValidator(props));
			return decoder;
		}
	}
}

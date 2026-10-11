package com.erp.gateway;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 내부 서비스 연결 재시도 (REL-05, application.yml default-filters Retry).
 * 응답을 받은 5xx는 다시 보내지 않고, 연결을 못 맺으면 기다리지 않고 오류로 끝난다.
 * auth 경로는 로그인 없이 통과하므로 그 경로로 확인한다. 연결 거부는 UpstreamConnectFailureTest.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UpstreamRetryTest {

	static final AtomicInteger hits = new AtomicInteger();
	static final HttpServer downstream = startDownstream();

	@LocalServerPort
	int port;

	WebTestClient client;

	@DynamicPropertySource
	static void routes(DynamicPropertyRegistry registry) {
		registry.add("IDENTITY_URI", () -> "http://localhost:" + downstream.getAddress().getPort());
	}

	@AfterAll
	static void stopDownstream() {
		downstream.stop(0);
	}

	@BeforeEach
	void setUp() {
		hits.set(0);
		client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).responseTimeout(Duration.ofSeconds(20)).build();
	}

	@Test
	void serverErrorResponseIsNotRetried() {
		client.get().uri("/api/auth/fail").exchange().expectStatus().isEqualTo(500);
		assertThat(hits.get()).isEqualTo(1);
	}

	private static HttpServer startDownstream() {
		try {
			HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
			server.createContext("/", exchange -> {
				hits.incrementAndGet();
				exchange.sendResponseHeaders(500, -1);
				exchange.close();
			});
			server.start();
			return server;
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}
}

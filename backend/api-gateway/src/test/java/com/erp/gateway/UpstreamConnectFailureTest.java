package com.erp.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.io.IOException;
import java.net.ServerSocket;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/** 내부 서비스에 연결하지 못하면(재시도 1회 뒤) 기다리지 않고 5xx로 끝난다 (REL-05). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class UpstreamConnectFailureTest {

	@LocalServerPort
	int port;

	@DynamicPropertySource
	static void routes(DynamicPropertyRegistry registry) {
		registry.add("IDENTITY_URI", () -> "http://localhost:" + closedPort());
	}

	@Test
	void refusedConnectionEndsWithErrorInsteadOfHanging() {
		WebTestClient client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port)
				.responseTimeout(Duration.ofSeconds(20)).build();
		long start = System.nanoTime();
		client.get().uri("/api/auth/anything").exchange().expectStatus().is5xxServerError();
		assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(10));
	}

	private static int closedPort() {
		try (ServerSocket socket = new ServerSocket(0)) {
			return socket.getLocalPort();
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}
}

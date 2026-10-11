package com.erp.gateway;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.event.KeyValuePair;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ClientErrorHandlerTest {

	final ListAppender<ILoggingEvent> appender = new ListAppender<>();
	final Logger logger = (Logger) LoggerFactory.getLogger("client-error");
	WebTestClient client;

	@BeforeEach
	void setUp() {
		appender.start();
		logger.addAppender(appender);
		var limiter = new ClientErrorLimiter(Clock.fixed(Instant.parse("2026-11-01T06:00:10Z"), ZoneOffset.UTC));
		client = WebTestClient.bindToRouterFunction(new ClientErrorHandler(JsonMapper.builder().build(), limiter).clientErrorRoute()).build();
	}

	@AfterEach
	void tearDown() {
		logger.detachAppender(appender);
	}

	Map<String, Object> loggedFields() {
		assertThat(appender.list).hasSize(1);
		Map<String, Object> fields = new HashMap<>();
		for (KeyValuePair kv : appender.list.get(0).getKeyValuePairs()) {
			fields.put(kv.key, kv.value);
		}
		return fields;
	}

	@Test
	void logsMaskedFieldsAndReturns204() {
		client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON).header("User-Agent", "Test UA")
				.header("X-Client-Ip", "203.0.113.7")
				.bodyValue("""
						{"kind":"RENDER","message":"failed for kim@example.com token eyJhbGciOi.eyJzdWIiOi.c2ln",
						 "stack":"at a (app.js:1)","url":"https://wy-worklog.com/reset?code=123456#x",
						 "release":"abc1234","relatedTraceId":"4bf92f3577b34da6a3ce929d0e0e4736","extra":"ignored"}
						""")
				.exchange().expectStatus().isNoContent();

		var fields = loggedFields();
		assertThat(fields).containsEntry("kind", "RENDER")
				.containsEntry("message", "failed for [email] token [token]")
				.containsEntry("url", "https://wy-worklog.com/reset")
				.containsEntry("release", "abc1234")
				.containsEntry("relatedTraceId", "4bf92f3577b34da6a3ce929d0e0e4736")
				.containsEntry("userAgent", "Test UA")
				.containsEntry("truncated", false);
		assertThat(fields.values()).doesNotContain("203.0.113.7");
	}

	@Test
	void truncatesLongFieldsAndNormalizesUnknownValues() {
		client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON)
				.bodyValue("{\"kind\":\"WHATEVER\",\"message\":\"" + "m".repeat(600) + "\",\"relatedTraceId\":\"not-hex\"}")
				.exchange().expectStatus().isNoContent();

		var fields = loggedFields();
		assertThat(fields).containsEntry("kind", "ERROR").containsEntry("truncated", true).containsEntry("relatedTraceId", null);
		assertThat((String) fields.get("message")).hasSize(500);
	}

	@Test
	void missingMessageOrNonJsonIs400() {
		for (String body : new String[] { "{\"stack\":\"x\"}", "not json", "[]", "{\"message\":\"  \"}" }) {
			client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON).bodyValue(body)
					.exchange().expectStatus().isBadRequest()
					.expectBody().jsonPath("$.code").isEqualTo("VALIDATION_FAILED");
		}
		assertThat(appender.list).isEmpty();
	}

	@Test
	void bodyOver16KbIs413() {
		client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON)
				.bodyValue("{\"message\":\"" + "x".repeat(17 * 1024) + "\"}")
				.exchange().expectStatus().isEqualTo(413)
				.expectBody().jsonPath("$.code").isEqualTo("PAYLOAD_TOO_LARGE");
	}

	@Test
	void eleventhRequestFromSameIpInAMinuteIs429AndNotLogged() {
		for (int i = 0; i < ClientErrorLimiter.PER_IP; i++) {
			client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON).header("X-Client-Ip", "203.0.113.7")
					.bodyValue("{\"message\":\"m\"}").exchange().expectStatus().isNoContent();
		}
		client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON).header("X-Client-Ip", "203.0.113.7")
				.bodyValue("{\"message\":\"m\"}").exchange().expectStatus().isEqualTo(429)
				.expectHeader().valueEquals("Retry-After", "50")
				.expectBody().jsonPath("$.code").isEqualTo("TOO_MANY_REQUESTS").jsonPath("$.retryAfterSeconds").isEqualTo(50);
		client.post().uri("/api/client-errors").contentType(MediaType.APPLICATION_JSON).header("X-Client-Ip", "198.51.100.1")
				.bodyValue("{\"message\":\"m\"}").exchange().expectStatus().isNoContent();
		assertThat(appender.list).hasSize(ClientErrorLimiter.PER_IP + 1);
	}
}

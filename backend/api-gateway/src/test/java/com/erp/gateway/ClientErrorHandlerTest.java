package com.erp.gateway;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.KeyValuePair;
import org.springframework.boot.logging.logback.StructuredLogEncoder;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.reactive.function.server.HandlerStrategies;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.test.web.reactive.server.WebTestClient;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
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
				.containsEntry("errorMessage", "failed for [email] token [token]")
				.containsEntry("errorStack", "at a (app.js:1)")
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
		assertThat((String) fields.get("errorMessage")).hasSize(500);
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

	/** 운영(prod)과 같은 logstash 구조화 JSON으로 실제로 써 본다. 키가 기본 칸·MDC 칸과 겹치면 encode가 예외를 던진다. */
	String encodeAsProduction(ILoggingEvent event) {
		LoggerContext context = new LoggerContext();
		context.putObject(Environment.class.getName(), new StandardEnvironment());
		StructuredLogEncoder encoder = new StructuredLogEncoder();
		encoder.setContext(context);
		encoder.setFormat("logstash");
		encoder.start();
		return new String(encoder.encode(event), StandardCharsets.UTF_8);
	}

	@Test
	void writesOneStructuredJsonLineWithoutFieldNameClashes() {
		// WebTestClient는 다른 스레드에서 처리해 MDC가 안 넘어가므로, 같은 스레드에서 핸들러를 직접 부른다.
		var handler = new ClientErrorHandler(JsonMapper.builder().build(),
				new ClientErrorLimiter(Clock.fixed(Instant.parse("2026-11-01T06:00:10Z"), ZoneOffset.UTC)));
		for (boolean traceIdInMdc : List.of(false, true)) {
			appender.list.clear();
			var exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/api/client-errors")
					.contentType(MediaType.APPLICATION_JSON).header("User-Agent", "Test UA")
					.body("{\"message\":\"boom kim@example.com\",\"stack\":\"at a (app.js:1)\",\"url\":\"https://wy-worklog.com/x?q=1\"}"));
			if (traceIdInMdc) {
				MDC.put("traceId", "4bf92f3577b34da6a3ce929d0e0e4736");
			}
			try {
				var response = handler.report(ServerRequest.create(exchange, HandlerStrategies.withDefaults().messageReaders())).block();
				assertThat(response.statusCode().value()).isEqualTo(204);
			} finally {
				MDC.remove("traceId");
			}
			assertThat(appender.list).hasSize(1);
			ILoggingEvent event = appender.list.get(0);
			assertThat(event.getMDCPropertyMap().containsKey("traceId")).isEqualTo(traceIdInMdc);

			var json = JsonMapper.builder().build().readTree(encodeAsProduction(event));
			assertThat(json.path("message").asString()).isEqualTo("프론트엔드 오류");
			assertThat(json.path("level").asString()).isEqualTo("WARN");
			assertThat(json.path("logger_name").asString()).isEqualTo("client-error");
			assertThat(json.path("errorMessage").asString()).isEqualTo("boom [email]");
			assertThat(json.path("errorStack").asString()).isEqualTo("at a (app.js:1)");
			assertThat(json.path("url").asString()).isEqualTo("https://wy-worklog.com/x");
			assertThat(json.path("userAgent").asString()).isEqualTo("Test UA");
			if (traceIdInMdc) {
				assertThat(json.path("traceId").asString()).isEqualTo("4bf92f3577b34da6a3ce929d0e0e4736");
			}
		}
	}
}

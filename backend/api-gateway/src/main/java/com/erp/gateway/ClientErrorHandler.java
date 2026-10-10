package com.erp.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 프론트엔드 오류 수집 POST /api/client-errors (P4-13, NFR-09, contracts/gateway.yaml).
 * 저장하지 않고 JSON 로그 한 줄(logger client-error, WARN)로 남긴다. 인증 없음, Origin·비밀 헤더·점검 필터는 그대로 받는다.
 * IP·쿠키·사용자 ID는 남기지 않고, url의 쿼리·프래그먼트를 지우며 이메일·JWT 모양을 가린다.
 */
@Configuration(proxyBeanMethods = false)
public class ClientErrorHandler {

	static final String PATH = "/api/client-errors";
	static final int MAX_BODY = 16 * 1024;

	private static final Logger log = LoggerFactory.getLogger("client-error");
	private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+");
	private static final Pattern JWT = Pattern.compile("eyJ[\\w-]*\\.[\\w-]*\\.[\\w-]*");
	private static final Pattern TRACE_ID = Pattern.compile("^[0-9a-f]{16,32}$");
	private static final Set<String> KINDS = Set.of("ERROR", "UNHANDLED_REJECTION", "RENDER");

	private final JsonMapper mapper;
	private final ClientErrorLimiter limiter;

	@Autowired
	ClientErrorHandler(JsonMapper mapper) {
		this(mapper, new ClientErrorLimiter(Clock.systemUTC()));
	}

	ClientErrorHandler(JsonMapper mapper, ClientErrorLimiter limiter) {
		this.mapper = mapper;
		this.limiter = limiter;
	}

	@Bean
	RouterFunction<ServerResponse> clientErrorRoute() {
		return RouterFunctions.route().POST(PATH, this::report).build();
	}

	Mono<ServerResponse> report(ServerRequest request) {
		long retryAfter = limiter.tryAcquire(request.headers().firstHeader(ClientIp.HEADER));
		if (retryAfter > 0) {
			return ServerResponse.status(HttpStatus.TOO_MANY_REQUESTS)
					.contentType(MediaType.APPLICATION_PROBLEM_JSON)
					.header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfter))
					.bodyValue(Problems.body(request.exchange(), HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS",
							"요청이 너무 많습니다.", ",\"retryAfterSeconds\":" + retryAfter));
		}
		if (request.headers().contentLength().orElse(0) > MAX_BODY) {
			return problem(request, HttpStatus.CONTENT_TOO_LARGE, "PAYLOAD_TOO_LARGE", "본문이 너무 큽니다.");
		}
		return DataBufferUtils.join(request.exchange().getRequest().getBody(), MAX_BODY)
				.map(buffer -> {
					try {
						return buffer.toString(StandardCharsets.UTF_8);
					} finally {
						DataBufferUtils.release(buffer);
					}
				})
				.defaultIfEmpty("")
				.flatMap(body -> handle(request, body))
				.onErrorResume(DataBufferLimitException.class,
						e -> problem(request, HttpStatus.CONTENT_TOO_LARGE, "PAYLOAD_TOO_LARGE", "본문이 너무 큽니다."));
	}

	private Mono<ServerResponse> handle(ServerRequest request, String body) {
		JsonNode node;
		try {
			node = body.isBlank() ? null : mapper.readTree(body);
		} catch (RuntimeException e) {
			node = null;
		}
		if (node == null || !node.isObject() || !node.path("message").isString() || node.path("message").asString().isBlank()) {
			return problem(request, HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "오류 내용이 없습니다.");
		}
		Truncation t = new Truncation();
		String kind = text(node, "kind");
		String relatedTraceId = text(node, "relatedTraceId");
		log.atWarn()
				.addKeyValue("traceId", TraceIdFilter.traceId(request.exchange()))
				.addKeyValue("kind", kind != null && KINDS.contains(kind) ? kind : "ERROR")
				.addKeyValue("message", t.cut(mask(text(node, "message")), 500))
				.addKeyValue("stack", t.cut(mask(text(node, "stack")), 4000))
				.addKeyValue("url", t.cut(stripQuery(text(node, "url")), 300))
				.addKeyValue("release", t.cut(text(node, "release"), 40))
				.addKeyValue("relatedTraceId", relatedTraceId != null && TRACE_ID.matcher(relatedTraceId).matches() ? relatedTraceId : null)
				.addKeyValue("userAgent", t.cut(request.headers().firstHeader(HttpHeaders.USER_AGENT), 300))
				.addKeyValue("truncated", t.truncated)
				.log("프론트엔드 오류");
		return ServerResponse.noContent().build();
	}

	private static String text(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value != null && value.isString() ? value.asString() : null;
	}

	static String mask(String value) {
		if (value == null) {
			return null;
		}
		return JWT.matcher(EMAIL.matcher(value).replaceAll("[email]")).replaceAll("[token]");
	}

	static String stripQuery(String url) {
		if (url == null) {
			return null;
		}
		int cut = url.length();
		for (char c : new char[] { '?', '#' }) {
			int i = url.indexOf(c);
			if (i >= 0 && i < cut) {
				cut = i;
			}
		}
		return url.substring(0, cut);
	}

	private static final class Truncation {
		boolean truncated;

		String cut(String value, int max) {
			if (value == null || value.length() <= max) {
				return value;
			}
			truncated = true;
			int end = Character.isHighSurrogate(value.charAt(max - 1)) ? max - 1 : max;
			return value.substring(0, end);
		}
	}

	private static Mono<ServerResponse> problem(ServerRequest request, HttpStatus status, String code, String detail) {
		return ServerResponse.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
				.bodyValue(Problems.body(request.exchange(), status, code, detail, ""));
	}
}

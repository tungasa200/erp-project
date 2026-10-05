package com.erp.gateway;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

/**
 * Gateway가 직접 내는 오류를 Problem Details(code·traceId)로 쓴다.
 * :common은 servlet 전용이라 형식만 같게 자체 구현한다 (backend1과 합의).
 */
public final class Problems {

	private Problems() {
	}

	public static Mono<Void> write(ServerWebExchange exchange, HttpStatus status, String code, String detail) {
		var response = exchange.getResponse();
		response.setStatusCode(status);
		response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
		String traceId = TraceIdFilter.traceId(exchange);
		String body = "{\"type\":\"about:blank\",\"title\":\"" + status.getReasonPhrase() + "\",\"status\":" + status.value()
				+ ",\"detail\":\"" + detail + "\",\"code\":\"" + code + "\",\"traceId\":"
				+ (traceId == null ? "null" : "\"" + traceId + "\"") + "}";
		var buffer = response.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
		return response.writeWith(Mono.just(buffer));
	}
}

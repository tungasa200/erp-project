package com.erp.gateway;

import io.micrometer.tracing.handler.TracingObservationHandler.TracingContext;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.observation.ServerRequestObservationContext;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * 요청마다 만들어진 trace의 traceId를 응답 헤더 X-Trace-Id로 돌려준다 (NFR-09).
 * traceId 생성과 내부 호출로의 traceparent 전달은 Micrometer Tracing(Brave, W3C)이 한다.
 */
@Component
public class TraceIdFilter implements WebFilter, Ordered {

	public static final String HEADER = "X-Trace-Id";

	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE;
	}

	@Override
	public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
		exchange.getResponse().beforeCommit(() -> {
			String traceId = traceId(exchange);
			if (traceId != null) {
				exchange.getResponse().getHeaders().set(HEADER, traceId);
			}
			return Mono.empty();
		});
		return chain.filter(exchange);
	}

	static String traceId(ServerWebExchange exchange) {
		return ServerRequestObservationContext.findCurrent(exchange.getAttributes())
				.map(context -> context.<TracingContext>get(TracingContext.class))
				.map(TracingContext::getSpan)
				.map(span -> span.context().traceId())
				.filter(id -> !id.isEmpty()) // 추적이 꺼져 있으면 no-op span이 빈 값을 준다
				.orElse(null);
	}
}

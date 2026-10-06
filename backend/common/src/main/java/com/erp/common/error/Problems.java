package com.erp.common.error;

import java.util.List;

import org.slf4j.MDC;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;

/**
 * 요구사항정의서 5.5 오류 형식: RFC 9457 Problem Details + code, errors[], traceId.
 */
public final class Problems {

	public static final String VALIDATION_FAILED = "VALIDATION_FAILED";
	public static final String UNAUTHENTICATED = "UNAUTHENTICATED";
	public static final String FORBIDDEN = "FORBIDDEN";
	public static final String NOT_FOUND = "NOT_FOUND";
	public static final String METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
	public static final String BAD_REQUEST = "BAD_REQUEST";
	public static final String CONFLICT = "CONFLICT";
	/** PATCH의 version이 현재 값과 다름 (D-58, 모든 서비스 공용). */
	public static final String VERSION_CONFLICT = "VERSION_CONFLICT";
	public static final String INTERNAL_ERROR = "INTERNAL_ERROR";

	/** 요청 제한 응답의 확장 필드 이름. ApiExceptionHandler가 같은 값을 Retry-After 헤더로도 준다. */
	public static final String RETRY_AFTER_SECONDS = "retryAfterSeconds";

	private Problems() {
	}

	public static ProblemDetail of(HttpStatusCode status, String code, String detail) {
		return of(status, code, detail, List.of());
	}

	public static ProblemDetail of(HttpStatusCode status, String code, String detail, List<FieldErrorDetail> errors) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
		return decorate(problem, code, errors);
	}

	/** Spring이 만든 ProblemDetail에 공통 확장 필드를 붙인다. */
	public static ProblemDetail decorate(ProblemDetail problem, String code, List<FieldErrorDetail> errors) {
		problem.setProperty("code", code);
		if (!errors.isEmpty()) {
			problem.setProperty("errors", errors);
		}
		problem.setProperty("traceId", currentTraceId());
		return problem;
	}

	/** Micrometer Tracing이 MDC에 넣는 traceId. 추적이 없으면 빈 문자열. */
	public static String currentTraceId() {
		String traceId = MDC.get("traceId");
		return traceId != null ? traceId : "";
	}

}

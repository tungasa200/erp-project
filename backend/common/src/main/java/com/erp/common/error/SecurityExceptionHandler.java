package com.erp.common.error;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Spring Security 인증·권한 오류를 Problem으로 바꾼다. Security가 클래스패스에 있을 때만 등록된다.
 * Spring은 순서가 앞선 advice에서 처리할 수 있는 핸들러를 먼저 고르므로, ApiExceptionHandler의
 * Exception 처리보다 앞서도록 가장 높은 우선순위를 준다.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityExceptionHandler {

	@ExceptionHandler(AuthenticationException.class)
	ResponseEntity<ProblemDetail> handleAuthentication(AuthenticationException ex) {
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
			.body(Problems.of(HttpStatus.UNAUTHORIZED, Problems.UNAUTHENTICATED, "인증이 필요합니다."));
	}

	@ExceptionHandler(AccessDeniedException.class)
	ResponseEntity<ProblemDetail> handleAccessDenied(AccessDeniedException ex) {
		return ResponseEntity.status(HttpStatus.FORBIDDEN)
			.body(Problems.of(HttpStatus.FORBIDDEN, Problems.FORBIDDEN, "권한이 없습니다."));
	}

}

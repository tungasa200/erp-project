package com.erp.common.error;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * 모든 오류 응답을 Problem Details(code, errors[], traceId)로 맞춘다.
 * Spring MVC 표준 예외는 부모 클래스가 ProblemDetail을 만들고, handleExceptionInternal에서 공통 필드를 붙인다.
 * Spring Security 예외는 SecurityExceptionHandler가 맡는다(Security가 없는 서비스에서도 이 클래스를 읽을 수 있게 분리).
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(ApiException.class)
	ResponseEntity<ProblemDetail> handleApi(ApiException ex) {
		ProblemDetail problem = Problems.of(ex.getStatus(), ex.getCode(), ex.getMessage(), ex.getErrors());
		ex.getProperties().forEach(problem::setProperty);
		return ResponseEntity.status(ex.getStatus()).body(problem);
	}

	@ExceptionHandler(Exception.class)
	ResponseEntity<ProblemDetail> handleUnexpected(Exception ex) {
		log.error("처리하지 못한 예외", ex);
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
			.body(Problems.of(HttpStatus.INTERNAL_SERVER_ERROR, Problems.INTERNAL_ERROR, "일시적인 오류가 발생했습니다."));
	}

	@Override
	protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
			HttpHeaders headers, HttpStatusCode status, WebRequest request) {
		// DTO 검증 애너테이션의 message에 오류 코드를 쓴다. 예: @NotBlank(message = "REQUIRED")
		List<FieldErrorDetail> errors = ex.getBindingResult()
			.getFieldErrors()
			.stream()
			.map(e -> new FieldErrorDetail(e.getField(), e.getDefaultMessage(), null))
			.toList();
		ProblemDetail problem = Problems.of(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.",
				errors);
		return ResponseEntity.badRequest().headers(headers).body(problem);
	}

	@Override
	protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
			HttpStatusCode statusCode, WebRequest request) {
		ResponseEntity<Object> response = super.handleExceptionInternal(ex, body, headers, statusCode, request);
		if (response != null && response.getBody() instanceof ProblemDetail problem
				&& problem.getProperties() == null) {
			Problems.decorate(problem, codeFor(statusCode), List.of());
		}
		return response;
	}

	private static String codeFor(HttpStatusCode status) {
		return switch (status.value()) {
			case 400 -> Problems.BAD_REQUEST;
			case 404 -> Problems.NOT_FOUND;
			case 405 -> Problems.METHOD_NOT_ALLOWED;
			case 409 -> Problems.CONFLICT;
			default -> status.is5xxServerError() ? Problems.INTERNAL_ERROR : "HTTP_" + status.value();
		};
	}

}

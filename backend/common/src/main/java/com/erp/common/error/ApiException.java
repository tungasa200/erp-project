package com.erp.common.error;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;

/**
 * 서비스 코드에서 던지는 업무 오류. ApiExceptionHandler가 Problem Details로 바꾼다.
 * properties는 Problem 본문에 그대로 추가할 확장 필드다(예: retryAfterSeconds).
 */
public class ApiException extends RuntimeException {

	private final HttpStatus status;
	private final String code;
	private final List<FieldErrorDetail> errors;
	private final Map<String, Object> properties;

	public ApiException(HttpStatus status, String code, String detail) {
		this(status, code, detail, List.of(), Map.of());
	}

	public ApiException(HttpStatus status, String code, String detail, List<FieldErrorDetail> errors,
			Map<String, Object> properties) {
		super(detail);
		this.status = status;
		this.code = code;
		this.errors = List.copyOf(errors);
		this.properties = Map.copyOf(properties);
	}

	public HttpStatus getStatus() {
		return status;
	}

	public String getCode() {
		return code;
	}

	public List<FieldErrorDetail> getErrors() {
		return errors;
	}

	public Map<String, Object> getProperties() {
		return properties;
	}

}

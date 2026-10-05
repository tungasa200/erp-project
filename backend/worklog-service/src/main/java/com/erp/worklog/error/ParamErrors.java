package com.erp.worklog.error;

import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.List;

/**
 * 쿼리·경로 값의 형식 오류(UUID·날짜 등)를 계약대로 VALIDATION_FAILED + errors[]로 돌려준다.
 * 공통 처리기는 이 경우 code=BAD_REQUEST만 준다.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class ParamErrors {

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	ResponseEntity<ProblemDetail> typeMismatch(MethodArgumentTypeMismatchException ex) {
		return ResponseEntity.badRequest().body(Problems.of(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED,
				"입력값을 확인해 주세요.", List.of(new FieldErrorDetail(ex.getName(), "INVALID_FORMAT", null))));
	}
}

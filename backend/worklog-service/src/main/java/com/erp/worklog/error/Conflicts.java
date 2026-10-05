package com.erp.worklog.error;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 동시 수정 충돌(409, code=VERSION_CONFLICT, identity와 같음 D-58). 요청의 version이 다르면 서비스가 바로 던지고, 같은 version으로 동시에 들어온 두 요청은
 * Hibernate 잠금 검사(UPDATE … WHERE version = ?)가 잡는다. 공통 처리기의 Exception 처리보다 먼저 받도록 순서를 앞에 둔다.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class Conflicts {

	static final String VERSION_CONFLICT_DETAIL = "다른 곳에서 먼저 수정됐어요. 새로 불러온 뒤 다시 시도해 주세요.";

	public static ApiException versionConflict() {
		return new ApiException(HttpStatus.CONFLICT, Problems.VERSION_CONFLICT, VERSION_CONFLICT_DETAIL);
	}

	@ExceptionHandler(ObjectOptimisticLockingFailureException.class)
	ResponseEntity<ProblemDetail> optimisticLock(ObjectOptimisticLockingFailureException ex) {
		return ResponseEntity.status(HttpStatus.CONFLICT)
				.body(Problems.of(HttpStatus.CONFLICT, Problems.VERSION_CONFLICT, VERSION_CONFLICT_DETAIL));
	}
}

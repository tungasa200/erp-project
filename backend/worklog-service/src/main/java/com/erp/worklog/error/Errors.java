package com.erp.worklog.error;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

/** 여러 기능이 같이 쓰는 업무 오류 (contracts/worklog.yaml components.responses). */
public final class Errors {

	private Errors() {
	}

	/** 없거나 다른 사용자의 리소스. 있다는 것도 드러내지 않는다. */
	public static ApiException notFound() {
		return new ApiException(HttpStatus.NOT_FOUND, Problems.NOT_FOUND, "찾을 수 없어요.");
	}

	public static ApiException duplicateName() {
		return new ApiException(HttpStatus.CONFLICT, "DUPLICATE_NAME", "같은 이름이 이미 있어요.");
	}

	/** 칸 하나의 입력 오류 (code=VALIDATION_FAILED). */
	public static ApiException invalid(String field, String code, String message) {
		return new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.",
				List.of(new FieldErrorDetail(field, code, message)), Map.of());
	}
}

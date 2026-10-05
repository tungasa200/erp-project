package com.erp.identity.auth;

import jakarta.validation.constraints.NotBlank;

/**
 * 로그인 요청. 이메일은 가입과 같은 방식으로 정규화해 비교한다.
 */
public record LoginRequest(@NotBlank(message = "REQUIRED") String email,
		@NotBlank(message = "REQUIRED") String password) {

	public LoginRequest {
		email = SignupRequest.normalizeEmail(email);
	}

}

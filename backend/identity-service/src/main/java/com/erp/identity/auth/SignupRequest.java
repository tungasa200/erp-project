package com.erp.identity.auth;

import java.util.Locale;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 가입 요청. 검증 message에 errors[].code를 쓴다(contracts/identity.yaml ValidationFailed).
 * 이메일은 받는 즉시 앞뒤 공백을 지우고 소문자로 바꾼다(D-46).
 */
@PasswordRules
public record SignupRequest(
		@NotBlank(message = "REQUIRED") @Email(message = "EMAIL_INVALID") @Size(max = 254,
				message = "EMAIL_INVALID") String email,
		@NotBlank(message = "REQUIRED") String password,
		@NotNull(message = "REQUIRED") @AssertTrue(message = "AGREEMENT_REQUIRED") Boolean agreeTerms,
		@NotNull(message = "REQUIRED") @AssertTrue(message = "AGREEMENT_REQUIRED") Boolean agreePrivacy) {

	public SignupRequest {
		email = normalizeEmail(email);
	}

	static String normalizeEmail(String email) {
		return email == null ? null : email.strip().toLowerCase(Locale.ROOT);
	}

}

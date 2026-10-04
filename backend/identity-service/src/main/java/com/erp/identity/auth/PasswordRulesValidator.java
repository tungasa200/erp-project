package com.erp.identity.auth;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * D-38: 8~64자(글자 수)이면서 UTF-8 72바이트 이하(BCrypt 처리 한도), 영문·숫자 포함, 이메일과 다른 문자열.
 */
public class PasswordRulesValidator implements ConstraintValidator<PasswordRules, SignupRequest> {

	static final int MIN_LENGTH = 8;

	static final int MAX_LENGTH = 64;

	static final int MAX_BYTES = 72;

	@Override
	public boolean isValid(SignupRequest request, ConstraintValidatorContext context) {
		String password = request.password();
		if (password == null || password.isBlank()) {
			return true; // REQUIRED는 @NotBlank가 낸다.
		}
		List<String> codes = violations(password, request.email());
		if (codes.isEmpty()) {
			return true;
		}
		context.disableDefaultConstraintViolation();
		codes.forEach(code -> context.buildConstraintViolationWithTemplate(code)
			.addPropertyNode("password")
			.addConstraintViolation());
		return false;
	}

	static List<String> violations(String password, String email) {
		List<String> codes = new ArrayList<>();
		int length = password.codePointCount(0, password.length());
		if (length < MIN_LENGTH || length > MAX_LENGTH) {
			codes.add("PASSWORD_LENGTH");
		}
		if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
			codes.add("PASSWORD_TOO_LONG_BYTES");
		}
		if (!password.chars().anyMatch(PasswordRulesValidator::isAsciiLetter)
				|| !password.chars().anyMatch(c -> c >= '0' && c <= '9')) {
			codes.add("PASSWORD_LETTER_DIGIT_REQUIRED");
		}
		if (email != null && password.equalsIgnoreCase(email)) {
			codes.add("PASSWORD_SAME_AS_EMAIL");
		}
		return codes;
	}

	private static boolean isAsciiLetter(int c) {
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
	}

}

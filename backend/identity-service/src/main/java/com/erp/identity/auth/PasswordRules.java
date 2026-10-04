package com.erp.identity.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * 비밀번호 규칙 (D-38). 이메일과 비교해야 해서 요청 전체에 붙인다. 어긴 규칙은 모두 password 칸 오류로 넣는다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PasswordRulesValidator.class)
public @interface PasswordRules {

	String message() default "PASSWORD_INVALID";

	Class<?>[] groups() default {};

	Class<? extends Payload>[] payload() default {};

}

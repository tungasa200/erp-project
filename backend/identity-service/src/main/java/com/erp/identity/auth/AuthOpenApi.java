package com.erp.identity.auth;

import java.util.List;

import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.common.error.Problems;

/**
 * 확장 필드가 있는 오류 본문 (contracts/identity.yaml): RateLimitedProblem(Problem + retryAfterSeconds),
 * CodeRejectedProblem(Problem + attemptsRemaining).
 */
@Configuration(proxyBeanMethods = false)
class AuthOpenApi {

	static final String RATE_LIMITED_PROBLEM_REF = "#/components/schemas/RateLimitedProblem";

	@Bean
	OpenApiCustomizer rateLimitedProblemSchema() {
		return openApi -> openApi.getComponents()
			.addSchemas("RateLimitedProblem", rateLimitedProblem())
			.addSchemas("CodeRejectedProblem", codeRejectedProblem());
	}

	/** 인증·재설정 코드 오류 (contracts/identity.yaml CodeRejectedProblem). Problem + attemptsRemaining. */
	@SuppressWarnings("rawtypes")
	private static Schema codeRejectedProblem() {
		Schema attempts = new ObjectSchema().addProperty("attemptsRemaining", new IntegerSchema().format(null)
			.description("CODE_MISMATCH일 때만. 남은 시도 횟수 (0이면 다음부터 CODE_EXPIRED)"));
		return new Schema<>().allOf(List.of(new Schema<>().$ref(OpenApiAutoConfiguration.PROBLEM_REF), attempts));
	}

	@SuppressWarnings("rawtypes")
	private static Schema rateLimitedProblem() {
		Schema retryAfter = new ObjectSchema()
			.addProperty(Problems.RETRY_AFTER_SECONDS,
					new IntegerSchema().format(null).description("다시 시도할 수 있을 때까지 남은 초. 잠금 안내 문구에 쓴다."))
			.required(List.of(Problems.RETRY_AFTER_SECONDS));
		return new Schema<>()
			.allOf(List.of(new Schema<>().$ref(OpenApiAutoConfiguration.PROBLEM_REF), retryAfter));
	}

}

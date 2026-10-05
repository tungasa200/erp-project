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
 * 로그인 429 응답 본문 RateLimitedProblem (contracts/identity.yaml). Problem + retryAfterSeconds.
 */
@Configuration(proxyBeanMethods = false)
class AuthOpenApi {

	static final String RATE_LIMITED_PROBLEM_REF = "#/components/schemas/RateLimitedProblem";

	@Bean
	OpenApiCustomizer rateLimitedProblemSchema() {
		return openApi -> openApi.getComponents().addSchemas("RateLimitedProblem", rateLimitedProblem());
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

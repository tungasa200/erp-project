package com.erp.common.autoconfigure;

import java.util.List;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.customizers.OpenApiCustomizer;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * springdoc 출력에 서비스 공통 부분을 넣는다 (P0-10, contracts/*.yaml과 맞춤).
 * - info 제목 "{spring.application.name} API", servers "/"(Gateway 뒤 같은 출처)
 * - Problem 스키마(RFC 9457 + code·errors[]·traceId)와 공통 Unauthorized 응답
 * - 보안 요구가 있는 operation에 401 Unauthorized를 붙인다
 * 보안 스킴(쿠키·Bearer·서비스 토큰)과 엔드포인트별 오류는 서비스마다 다르므로 각 서비스가 주석으로 선언한다.
 * 엔드포인트별 오류 응답은 {@link #PROBLEM_REF}를 참조한다.
 */
@AutoConfiguration
public class OpenApiAutoConfiguration {

	public static final String PROBLEM_REF = "#/components/schemas/Problem";

	static final String UNAUTHORIZED_REF = "#/components/responses/Unauthorized";

	// springdoc은 서비스에 따라 없을 수 있어(compileOnly), 있을 때만 이 설정을 읽는다.
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnClass(name = "org.springdoc.core.customizers.OpenApiCustomizer")
	static class SpringdocConfiguration {

		@Bean
		OpenApiCustomizer commonOpenApiCustomizer(Environment env) {
			String title = env.getProperty("spring.application.name", "service") + " API";
			return openApi -> customize(openApi, title);
		}

	}

	static void customize(OpenAPI openApi, String title) {
		openApi.getInfo().setTitle(title);
		openApi.setServers(List.of(new Server().url("/")));

		if (openApi.getComponents() == null) {
			openApi.setComponents(new Components());
		}
		openApi.getComponents()
			.addSchemas("Problem", problemSchema())
			.addResponses("Unauthorized", new ApiResponse()
				.description("토큰 없음·만료·서명 오류·aud 불일치 (code=UNAUTHENTICATED), 또는 탈퇴한 사용자 (code=USER_DELETED).\n"
						+ "프론트는 UNAUTHENTICATED일 때 refresh 1회 후 재시도한다 (P0-07).")
				.content(problemContent()));

		if (openApi.getPaths() != null) {
			openApi.getPaths().values().forEach(path -> path.readOperations().forEach(OpenApiAutoConfiguration::addUnauthorized));
		}
	}

	private static void addUnauthorized(Operation op) {
		if (op.getSecurity() != null && !op.getSecurity().isEmpty() && !op.getResponses().containsKey("401")) {
			op.getResponses().addApiResponse("401", new ApiResponse().$ref(UNAUTHORIZED_REF));
		}
	}

	static Content problemContent() {
		return new Content().addMediaType("application/problem+json",
				new MediaType().schema(new Schema<>().$ref(PROBLEM_REF)));
	}

	@SuppressWarnings("rawtypes")
	private static Schema problemSchema() {
		Schema fieldError = new ObjectSchema()
			.addProperty("field", new StringSchema())
			.addProperty("code", new StringSchema())
			.addProperty("message", new StringSchema())
			.required(List.of("field", "code"));
		return new ObjectSchema()
			.description("RFC 9457 Problem Details + 확장 필드 (P0-10 공통 모듈 형식)")
			.addProperty("type", new StringSchema().format("uri-reference"))
			.addProperty("title", new StringSchema())
			.addProperty("status", new IntegerSchema().format(null))
			.addProperty("detail", new StringSchema())
			.addProperty("instance", new StringSchema())
			.addProperty("code", new StringSchema().description("기계 판독용 오류 코드"))
			.addProperty("errors", new ArraySchema().items(fieldError))
			.addProperty("traceId", new StringSchema())
			.required(List.of("type", "title", "status", "code", "traceId"));
	}

}

package com.erp.worklog.schedule;

import java.util.List;
import java.util.Map;
import java.util.Set;

import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * recurrence 칸을 oneOf [Recurrence, null]로 바꾼다. 주석으로 type을 [object, null]로 주면 $ref 옆에 type이 붙는데,
 * $ref의 형제 키는 생성 도구(openapi-typescript)가 무시해 null을 보낼 수 없는 타입이 된다 ("recurrence: null이면 반복 제거").
 */
@Configuration(proxyBeanMethods = false)
class ScheduleOpenApi {

	private static final String RECURRENCE_REF = "#/components/schemas/Recurrence";

	@Bean
	OpenApiCustomizer nullableRecurrence() {
		return openApi -> {
			Map<String, Schema> schemas = openApi.getComponents().getSchemas();
			for (String name : List.of("Schedule", "ScheduleCreate", "SchedulePatch")) {
				Schema<?> schema = schemas.get(name);
				if (schema != null && schema.getProperties() != null && schema.getProperties().containsKey("recurrence")) {
					schema.getProperties().put("recurrence", nullableRef());
				}
			}
		};
	}

	@SuppressWarnings("rawtypes")
	private static Schema nullableRef() {
		return new Schema<>().oneOf(List.of(new Schema<>().$ref(RECURRENCE_REF), new Schema<>().types(Set.of("null"))));
	}

}

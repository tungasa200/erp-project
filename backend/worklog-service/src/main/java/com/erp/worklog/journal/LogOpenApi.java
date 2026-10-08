package com.erp.worklog.journal;

import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** LogContent.time(소요시간 표, 옵션 꺼짐이면 null)을 oneOf [$ref TimeSummary, null]로 바꾼다 (TimeOpenApi와 같은 이유). */
@Configuration(proxyBeanMethods = false)
class LogOpenApi {

	@Bean
	OpenApiCustomizer nullableLogTime() {
		return openApi -> {
			Schema<?> content = openApi.getComponents().getSchemas().get("LogContent");
			if (content == null) {
				return;
			}
			content.addProperty("time", new Schema<>().oneOf(List.of(
					new Schema<>().$ref("#/components/schemas/TimeSummary"), new Schema<>().types(Set.of("null")))));
			List<String> required = content.getRequired() == null ? new ArrayList<>() : new ArrayList<>(content.getRequired());
			if (!required.contains("time")) {
				required.add("time");
				content.setRequired(required);
			}
		};
	}
}

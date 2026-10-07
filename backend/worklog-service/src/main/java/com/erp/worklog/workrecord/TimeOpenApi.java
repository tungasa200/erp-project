package com.erp.worklog.workrecord;

import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 타이머·빈 시간 응답의 null일 수 있는 객체 칸을 oneOf [$ref, null]로 바꾼다 (ScheduleOpenApi와 같은 이유:
 * $ref 옆의 type은 openapi-typescript가 무시한다). TimeGap.frequent는 숨긴 칸이라 여기서 붙이고 required에 넣는다.
 */
@Configuration(proxyBeanMethods = false)
class TimeOpenApi {

	private static final List<String[]> NULLABLE = List.of(
			new String[] { "TimerState", "running", "WorkRecord" },
			new String[] { "TimerStartResult", "stopped", "TimerStopped" },
			new String[] { "TimerStopResult", "stopped", "TimerStopped" },
			new String[] { "TimerStopResult", "next", "PlanBlock" },
			new String[] { "TimeGap", "previous", "TimeGapPrevious" },
			new String[] { "TimeGap", "plan", "TimeGapPlan" },
			new String[] { "TimeGap", "frequent", "FrequentTask" });

	@Bean
	@SuppressWarnings({ "rawtypes", "unchecked" })
	OpenApiCustomizer nullableTimeRefs() {
		return openApi -> {
			Map<String, Schema> schemas = openApi.getComponents().getSchemas();
			for (String[] n : NULLABLE) {
				Schema<?> schema = schemas.get(n[0]);
				if (schema == null) {
					continue;
				}
				schema.addProperty(n[1], new Schema<>().oneOf(List.of(new Schema<>().$ref("#/components/schemas/" + n[2]),
						new Schema<>().types(Set.of("null")))));
				List<String> required = schema.getRequired() == null ? new ArrayList<>() : new ArrayList<>(schema.getRequired());
				if (!required.contains(n[1])) {
					required.add(n[1]);
					schema.setRequired(required);
				}
			}
		};
	}
}

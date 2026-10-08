package com.erp.worklog.journal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.Map.Entry;

/**
 * 한국 공휴일 (D-74). 저장소 루트 shared/holidays/KR.json을 빌드가 jar의 holidays/KR.json으로 넣는다(build.gradle).
 * 파일이 없으면 기동이 실패한다 — 공휴일 없이 근무일을 잘못 세는 것보다 낫다.
 */
@Component
class Holidays {

	private final Map<LocalDate, String> names;

	Holidays(@Value("${worklog.holidays.location:classpath:holidays/KR.json}") Resource location, JsonMapper json)
			throws IOException {
		Map<LocalDate, String> map = new HashMap<>();
		try (InputStream in = location.getInputStream()) {
			for (Entry<String, JsonNode> year : json.readTree(in).properties()) {
				for (Entry<String, JsonNode> day : year.getValue().properties()) {
					map.put(LocalDate.parse(day.getKey()), day.getValue().asString());
				}
			}
		}
		this.names = Map.copyOf(map);
	}

	/** 공휴일 이름, 아니면 null. */
	String name(LocalDate date) {
		return names.get(date);
	}
}

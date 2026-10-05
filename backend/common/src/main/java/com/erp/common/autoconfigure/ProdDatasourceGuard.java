package com.erp.common.autoconfigure;

import java.util.List;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;

/**
 * 운영(prod)에서 DB 접속 정보가 빠지면 컨텍스트를 만들기 전에 기동을 막는다 (P0-09).
 * 빠진 채로 뜨면 로컬 기본값으로 접속을 시도해 원인이 흐린 인증 오류(28P01)만 남는다.
 * 각 서비스는 prod 프로필에서 spring.datasource.*의 로컬 기본값을 빈 값으로 덮어써 이 검사에 걸리게 한다.
 */
public class ProdDatasourceGuard implements EnvironmentPostProcessor, Ordered {

	static final List<String> REQUIRED = List.of("spring.datasource.url", "spring.datasource.username",
			"spring.datasource.password");

	@Override
	public int getOrder() {
		// 설정 파일(application.yml)을 읽은 뒤에 검사한다
		return Ordered.LOWEST_PRECEDENCE;
	}

	@Override
	public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication application) {
		if (!env.matchesProfiles("prod")) {
			return;
		}
		List<String> missing = REQUIRED.stream().filter(key -> isMissing(env, key)).toList();
		if (!missing.isEmpty()) {
			throw new IllegalStateException("prod 프로필에 DB 접속 정보가 없습니다: " + missing
					+ " (DB_URL·DB_USERNAME·DB_PASSWORD 변수 확인)");
		}
	}

	private static boolean isMissing(ConfigurableEnvironment env, String key) {
		try {
			String value = env.getProperty(key);
			return value == null || value.isBlank() || value.contains("${");
		}
		catch (IllegalArgumentException e) {
			// 기본값 없는 ${VAR}를 풀지 못하면 예외가 난다. 빠진 값과 같이 다룬다
			return true;
		}
	}

}

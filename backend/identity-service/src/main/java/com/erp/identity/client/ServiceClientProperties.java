package com.erp.identity.client;

import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 서비스 토큰을 받을 클라이언트 (D-29). 키는 client_id, scopes는 공백 구분.
 * 비밀값은 환경 변수로만 넣는다. 로컬 기본값은 application.yml, 운영(prod)은 기본값이 없어 없으면 기동에 실패한다.
 */
@ConfigurationProperties("identity")
public record ServiceClientProperties(Map<String, Client> serviceClients) {

	public ServiceClientProperties {
		serviceClients = serviceClients == null ? Map.of() : Map.copyOf(serviceClients);
	}

	/** Spring Boot는 풀리지 않은 ${...}를 글자 그대로 넣으므로, 비밀값 환경 변수가 없으면 여기서 기동을 막는다. */
	public record Client(String secret, String scopes) {

		public Client {
			if (secret == null || secret.isBlank() || secret.contains("${")) {
				throw new IllegalStateException("서비스 클라이언트 비밀값 환경 변수가 없습니다(예: WORKLOG_CLIENT_SECRET).");
			}
			if (scopes == null || scopes.isBlank()) {
				throw new IllegalStateException("서비스 클라이언트 scopes가 비어 있습니다.");
			}
		}

	}

}

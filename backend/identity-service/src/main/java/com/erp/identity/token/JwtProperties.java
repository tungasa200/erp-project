package com.erp.identity.token;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * JWT 서명 키 (D-18). privateKey는 PKCS#8 PEM이며 비어 있으면 임시 키를 만든다(로컬 전용).
 * Spring Boot는 풀리지 않은 ${...}를 오류 없이 글자 그대로 넣으므로, 환경 변수가 없으면 여기서 기동을 막는다.
 */
@ConfigurationProperties("identity.jwt")
public record JwtProperties(String privateKey, String keyId) {

	public JwtProperties {
		if (unresolved(privateKey)) {
			throw new IllegalStateException("JWT_PRIVATE_KEY 환경 변수가 없습니다.");
		}
		if (keyId == null || keyId.isBlank() || unresolved(keyId)) {
			throw new IllegalStateException("JWT_KEY_ID 환경 변수가 없습니다.");
		}
	}

	/** 풀리지 않은 자리표시자("${JWT_KEY_ID}")가 그대로 들어온 값. */
	static boolean unresolved(String value) {
		return value != null && value.contains("${");
	}

}

package com.erp.worklog.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * identity 내부 호출 설정. 비밀값은 환경변수로만 넣는다.
 *
 * @param baseUri      identity 내부 주소 (Railway private network, 로컬 localhost:8081)
 * @param clientId     서비스 토큰 발급용 client_id
 * @param clientSecret 서비스 토큰 발급용 secret
 */
@ConfigurationProperties("worklog.identity")
public record IdentityProperties(String baseUri, String clientId, String clientSecret) {
}

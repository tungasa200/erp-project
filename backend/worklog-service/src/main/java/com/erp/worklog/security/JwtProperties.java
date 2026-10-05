package com.erp.worklog.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * identity가 발급한 사용자 토큰 검증 설정 (contracts/identity.yaml).
 */
@ConfigurationProperties("worklog.jwt")
public record JwtProperties(String jwkSetUri, String issuer, String audience) {
}

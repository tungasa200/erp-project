package com.erp.gateway;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * @param jwkSetUri      identity의 JWKS 내부 주소
 * @param issuer         사용자 토큰 iss
 * @param audience       사용자 토큰 aud
 * @param allowedOrigins 쓰기 요청을 받을 Origin 목록 (NFR-02)
 */
@ConfigurationProperties("gateway")
public record GatewayProperties(String jwkSetUri, String issuer, String audience, List<String> allowedOrigins) {
}

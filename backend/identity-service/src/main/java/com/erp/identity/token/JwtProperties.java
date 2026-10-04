package com.erp.identity.token;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * JWT 서명 키 (D-18). privateKey는 PKCS#8 PEM이며 비어 있으면 임시 키를 만든다(로컬 전용).
 */
@ConfigurationProperties("identity.jwt")
public record JwtProperties(String privateKey, String keyId) {
}

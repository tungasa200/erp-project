package com.erp.identity.token;

import java.util.Map;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * JWT 서명 공개키. Gateway가 외부로 라우팅하지 않는 내부 전용 경로다.
 */
@Tag(name = "jwks", description = "JWT 공개키 (내부 전용)")
@RestController
public class JwksController {

	private final Map<String, Object> jwks;

	public JwksController(RSAKey signingKey) {
		this.jwks = new JWKSet(signingKey).toPublicJWKSet().toJSONObject();
	}

	@Operation(operationId = "getJwks", summary = "JWT 서명 공개키 (내부 전용)")
	@GetMapping("/.well-known/jwks.json")
	public Map<String, Object> jwks() {
		return jwks;
	}

}

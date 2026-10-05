package com.erp.common.test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import com.erp.common.security.JwtClaimNames;

/**
 * 테스트용 RS256 키와 토큰. 키는 테스트 JVM마다 한 번 만든다.
 * 서비스 테스트는 jwkSetJson()을 내려주는 가짜 JWKS 서버나 publicKey()로 만든 JwtDecoder로 검증한다.
 */
public final class TestJwt {

	public static final String KEY_ID = "test-key";

	private static final RSAKey KEY = generate();

	private TestJwt() {
	}

	/** 정상 사용자 토큰 (aud=erp-api, 10분). */
	public static String userToken(UUID userId) {
		return sign(baseClaims(userId.toString(), JwtClaimNames.AUDIENCE_API, Duration.ofMinutes(10)).build());
	}

	/** 이미 만료된 사용자 토큰. */
	public static String expiredUserToken(UUID userId) {
		Instant issuedAt = Instant.now().minus(Duration.ofMinutes(20));
		return sign(new JWTClaimsSet.Builder().issuer(JwtClaimNames.ISSUER)
			.subject(userId.toString())
			.audience(JwtClaimNames.AUDIENCE_API)
			.issueTime(Date.from(issuedAt))
			.expirationTime(Date.from(issuedAt.plus(Duration.ofMinutes(10))))
			.build());
	}

	/** 서비스 토큰 (aud=erp-internal, sub=service:<clientId>, 5분). */
	public static String serviceToken(String clientId, String... scopes) {
		return sign(baseClaims(JwtClaimNames.SERVICE_SUBJECT_PREFIX + clientId, JwtClaimNames.AUDIENCE_INTERNAL,
				Duration.ofMinutes(5))
			.claim(JwtClaimNames.SCOPE, String.join(" ", List.of(scopes)))
			.build());
	}

	/** 임의 클레임으로 서명한다 (잘못된 iss·aud 검증 테스트용). */
	public static String sign(JWTClaimsSet claims) {
		try {
			SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY_ID).build(), claims);
			jwt.sign(new RSASSASigner(KEY));
			return jwt.serialize();
		}
		catch (JOSEException ex) {
			throw new IllegalStateException(ex);
		}
	}

	public static RSAPublicKey publicKey() {
		try {
			return KEY.toRSAPublicKey();
		}
		catch (JOSEException ex) {
			throw new IllegalStateException(ex);
		}
	}

	/** /.well-known/jwks.json 응답과 같은 형식의 공개키 JSON. */
	public static String jwkSetJson() {
		return new JWKSet(KEY.toPublicJWK()).toString();
	}

	private static JWTClaimsSet.Builder baseClaims(String subject, String audience, Duration ttl) {
		Instant now = Instant.now();
		return new JWTClaimsSet.Builder().issuer(JwtClaimNames.ISSUER)
			.subject(subject)
			.audience(audience)
			.issueTime(Date.from(now))
			.expirationTime(Date.from(now.plus(ttl)));
	}

	private static RSAKey generate() {
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			KeyPair pair = generator.generateKeyPair();
			return new RSAKey.Builder((RSAPublicKey) pair.getPublic()).privateKey((RSAPrivateKey) pair.getPrivate())
				.keyID(KEY_ID)
				.build();
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}

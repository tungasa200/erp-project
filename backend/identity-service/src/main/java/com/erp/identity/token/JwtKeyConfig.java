package com.erp.identity.token;

import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;
import java.util.List;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import com.erp.common.security.JwtClaimNames;

/**
 * RS256 서명 키를 읽어 서명(encoder)·자체 검증(decoder)·JWKS 공개에 함께 쓴다 (D-18, NFR-03).
 * 개인키는 identity만 가진다. 키를 교체할 때는 JWKS에 이전 공개키를 함께 게시하는 기능을 그때 추가한다.
 */
@Configuration
@EnableConfigurationProperties(JwtProperties.class)
public class JwtKeyConfig {

	private static final Logger log = LoggerFactory.getLogger(JwtKeyConfig.class);

	@Bean
	RSAKey signingKey(JwtProperties props) {
		RSAKey.Builder builder = (props.privateKey() == null || props.privateKey().isBlank()) ? temporaryKey()
				: fromPem(props.privateKey());
		return builder.keyID(props.keyId()).keyUse(KeyUse.SIGNATURE).algorithm(JWSAlgorithm.RS256).build();
	}

	@Bean
	JwtEncoder jwtEncoder(RSAKey signingKey) {
		return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(signingKey)));
	}

	/** /api/users/me 검증용. 자기 공개키로 바로 검증하므로 JWKS를 HTTP로 다시 받지 않는다. */
	@Bean
	JwtDecoder jwtDecoder(RSAKey signingKey) throws Exception {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(signingKey.toRSAPublicKey()).build();
		decoder.setJwtValidator(userTokenValidator());
		return decoder;
	}

	/** 만료·iss 검증에 aud=erp-api 확인을 더한다. 서비스 토큰(aud=erp-internal)은 사용자 API에서 거부된다. */
	static OAuth2TokenValidator<Jwt> userTokenValidator() {
		return new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(JwtClaimNames.ISSUER),
				new JwtClaimValidator<List<String>>("aud",
						aud -> aud != null && aud.contains(JwtClaimNames.AUDIENCE_API)));
	}

	/** /internal/** 검증용. aud=erp-internal만 허용하며 scope는 SCOPE_ 권한으로 바뀐다. 사용자 토큰은 여기서 거부된다. */
	public static JwtDecoder serviceTokenDecoder(RSAKey signingKey) {
		try {
			NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(signingKey.toRSAPublicKey()).build();
			decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
					JwtValidators.createDefaultWithIssuer(JwtClaimNames.ISSUER), new JwtClaimValidator<List<String>>(
							"aud", aud -> aud != null && aud.contains(JwtClaimNames.AUDIENCE_INTERNAL))));
			return decoder;
		}
		catch (JOSEException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private static RSAKey.Builder temporaryKey() {
		log.warn("identity.jwt.private-key가 없어 임시 서명 키를 만듭니다. 재시작하면 발급한 토큰이 모두 무효가 됩니다(로컬 전용).");
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			var pair = generator.generateKeyPair();
			return new RSAKey.Builder((RSAPublicKey) pair.getPublic()).privateKey(pair.getPrivate());
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

	/** PKCS#8 PEM("-----BEGIN PRIVATE KEY-----")에서 공개키까지 만든다. 환경 변수에 줄바꿈이 \n 문자로 들어와도 읽는다. */
	static RSAKey.Builder fromPem(String pem) {
		String base64 = pem.replace("\\n", "\n")
			.replace("-----BEGIN PRIVATE KEY-----", "")
			.replace("-----END PRIVATE KEY-----", "")
			.replaceAll("\\s", "");
		try {
			KeyFactory factory = KeyFactory.getInstance("RSA");
			var privateKey = (RSAPrivateCrtKey) factory
				.generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
			var publicKey = (RSAPublicKey) factory
				.generatePublic(new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPublicExponent()));
			return new RSAKey.Builder(publicKey).privateKey(privateKey);
		}
		catch (NoSuchAlgorithmException | InvalidKeySpecException | IllegalArgumentException | ClassCastException ex) {
			throw new IllegalStateException("identity.jwt.private-key를 RSA PKCS#8 PEM으로 읽을 수 없습니다.", ex);
		}
	}

}

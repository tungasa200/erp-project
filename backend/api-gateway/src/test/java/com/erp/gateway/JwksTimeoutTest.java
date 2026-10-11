package com.erp.gateway;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;

import java.net.ServerSocket;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** identity가 응답하지 않으면 키 받기를 짧게 끊는다 (REL-05). */
class JwksTimeoutTest {

	@Test
	void unresponsiveJwksFailsFast() throws Exception {
		// 연결은 받아 주지만(대기열) 아무 응답도 하지 않는 서버 → 응답 시간 제한으로 끝나야 한다
		try (ServerSocket silent = new ServerSocket(0)) {
			var props = new GatewayProperties("http://localhost:" + silent.getLocalPort() + "/.well-known/jwks.json",
					"erp-identity", "erp-api", List.of(), "");
			var decoder = new SecurityConfig().jwtDecoder(props);
			String token = signedToken();

			long start = System.nanoTime();
			// 리액티브 디코더는 키를 못 받으면 IllegalStateException("Could not obtain the keys")으로 끝난다
			assertThatThrownBy(() -> decoder.decode(token).block(Duration.ofSeconds(30))).hasMessageContaining("keys");
			assertThat(Duration.ofNanos(System.nanoTime() - start))
					.isLessThan(SecurityConfig.JWKS_CONNECT_TIMEOUT.plus(SecurityConfig.JWKS_READ_TIMEOUT).plusSeconds(2));
		}
	}

	static String signedToken() throws Exception {
		var generator = KeyPairGenerator.getInstance("RSA");
		generator.initialize(2048);
		var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("k1").build(),
				new JWTClaimsSet.Builder().issuer("erp-identity").subject("u").build());
		jwt.sign(new RSASSASigner(generator.generateKeyPair().getPrivate()));
		return jwt.serialize();
	}
}

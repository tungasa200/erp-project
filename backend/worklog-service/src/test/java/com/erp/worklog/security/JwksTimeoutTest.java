package com.erp.worklog.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtException;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** JWKS 받기: 응답이 없으면 짧게 끊고(기본 30초 아님), 한 번 받은 키는 모르는 kid가 올 때까지 계속 쓴다 (REL-05). */
class JwksTimeoutTest {

	@Test
	void unresponsiveJwksFailsFast() throws Exception {
		// 연결은 받아 주지만(대기열) 아무 응답도 하지 않는 서버 → 읽기 시간 제한으로 끝나야 한다
		try (ServerSocket silent = new ServerSocket(0)) {
			var props = new JwtProperties("http://localhost:" + silent.getLocalPort() + "/.well-known/jwks.json", "erp-identity", "erp-api");
			var decoder = new SecurityConfig().jwtDecoder(props);
			String token = signedToken();

			long start = System.nanoTime();
			assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
			assertThat(Duration.ofNanos(System.nanoTime() - start))
					.isLessThan(SecurityConfig.JWKS_CONNECT_TIMEOUT.plus(SecurityConfig.JWKS_READ_TIMEOUT).plusSeconds(2));
		}
	}

	@Test
	void keysAreFetchedOnceAndRefetchedOnlyForUnknownKid() throws Exception {
		KeyPair k1 = keyPair();
		KeyPair k2 = keyPair();
		AtomicReference<KeyPair> published = new AtomicReference<>(k1);
		AtomicInteger fetches = new AtomicInteger();
		HttpServer jwks = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
		jwks.createContext("/", exchange -> {
			fetches.incrementAndGet();
			String kid = published.get() == k1 ? "k1" : "k2";
			byte[] body = new JWKSet(new RSAKey.Builder((RSAPublicKey) published.get().getPublic()).keyID(kid).build())
					.toString().getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, body.length);
			exchange.getResponseBody().write(body);
			exchange.close();
		});
		jwks.start();
		try {
			var props = new JwtProperties("http://localhost:" + jwks.getAddress().getPort() + "/jwks", "erp-identity", "erp-api");
			var decoder = new SecurityConfig().jwtDecoder(props);

			decoder.decode(signedToken(k1, "k1"));
			decoder.decode(signedToken(k1, "k1"));
			assertThat(fetches.get()).isEqualTo(1);

			// 키 교체: 새 kid 토큰이 오면 그때 다시 받는다
			published.set(k2);
			decoder.decode(signedToken(k2, "k2"));
			assertThat(fetches.get()).isEqualTo(2);
			decoder.decode(signedToken(k2, "k2"));
			assertThat(fetches.get()).isEqualTo(2);
		} finally {
			jwks.stop(0);
		}
	}

	static KeyPair keyPair() throws Exception {
		var generator = KeyPairGenerator.getInstance("RSA");
		generator.initialize(2048);
		return generator.generateKeyPair();
	}

	static String signedToken() throws Exception {
		return signedToken(keyPair(), "k1");
	}

	static String signedToken(KeyPair keys, String kid) throws Exception {
		Instant now = Instant.now();
		var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(),
				new JWTClaimsSet.Builder().issuer("erp-identity").subject("u").audience("erp-api")
						.issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(600))).build());
		jwt.sign(new RSASSASigner(keys.getPrivate()));
		return jwt.serialize();
	}
}

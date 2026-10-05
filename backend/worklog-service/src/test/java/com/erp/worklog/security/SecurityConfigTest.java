package com.erp.worklog.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.erp.common.autoconfigure.CommonWebAutoConfiguration;
import com.erp.worklog.user.DeletedUserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 사용자 토큰 검증 규칙(iss·aud·exp·서명)과 CurrentUser 식별을 확인한다.
 * TODO: common testFixtures(com.erp.common.test)의 키·토큰 유틸이 생기면 여기 키 생성을 그것으로 바꾼다.
 */
@WebMvcTest(controllers = SecurityConfigTest.ProbeController.class)
@ImportAutoConfiguration(CommonWebAutoConfiguration.class) // 슬라이스 테스트는 공통 자동 설정(ProblemSecurityHandler)을 읽지 않는다
@Import({SecurityConfig.class, WebConfig.class, SecurityConfigTest.TestKeys.class, SecurityConfigTest.ProbeController.class})
class SecurityConfigTest {

	static final KeyPair KEYS = generateKeys();
	static final KeyPair OTHER_KEYS = generateKeys();
	static final UUID USER_ID = UUID.fromString("0192f3a0-0000-7000-8000-000000000001");

	@Autowired
	MockMvc mvc;

	/** WebConfig가 등록하는 탈퇴 사용자 인터셉터용. 여기서는 아무도 탈퇴하지 않았다. */
	@MockitoBean
	DeletedUserRepository deletedUsers;

	@Test
	void validUserTokenIdentifiesUser() throws Exception {
		mvc.perform(get("/api/worklog/probe").header("Authorization", bearer(token(KEYS, "erp-identity", "erp-api", 600))))
				.andExpect(status().isOk())
				.andExpect(content().string(USER_ID.toString()));
	}

	@Test
	void missingTokenIsRejected() throws Exception {
		mvc.perform(get("/api/worklog/probe"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
	}

	@Test
	void serviceTokenAudienceIsRejected() throws Exception {
		mvc.perform(get("/api/worklog/probe").header("Authorization", bearer(token(KEYS, "erp-identity", "erp-internal", 600))))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void wrongIssuerIsRejected() throws Exception {
		mvc.perform(get("/api/worklog/probe").header("Authorization", bearer(token(KEYS, "someone-else", "erp-api", 600))))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void expiredTokenIsRejected() throws Exception {
		// 기본 허용 오차 60초보다 더 지난 토큰
		mvc.perform(get("/api/worklog/probe").header("Authorization", bearer(token(KEYS, "erp-identity", "erp-api", -120))))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void tokenSignedByOtherKeyIsRejected() throws Exception {
		mvc.perform(get("/api/worklog/probe").header("Authorization", bearer(token(OTHER_KEYS, "erp-identity", "erp-api", 600))))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
	}

	@Test
	void pathsOutsideWorklogApiAreDenied() throws Exception {
		mvc.perform(get("/internal/anything").header("Authorization", bearer(token(KEYS, "erp-identity", "erp-api", 600))))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));
	}

	private static String bearer(String token) {
		return "Bearer " + token;
	}

	private static String token(KeyPair keys, String issuer, String audience, long expiresInSeconds) throws Exception {
		Instant now = Instant.now();
		JWTClaimsSet claims = new JWTClaimsSet.Builder()
				.issuer(issuer)
				.subject(USER_ID.toString())
				.audience(audience)
				.issueTime(Date.from(now))
				.expirationTime(Date.from(now.plusSeconds(expiresInSeconds)))
				.build();
		SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test").build(), claims);
		jwt.sign(new RSASSASigner(keys.getPrivate()));
		return jwt.serialize();
	}

	private static KeyPair generateKeys() {
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			return generator.generateKeyPair();
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	@TestConfiguration
	static class TestKeys {
		/** JWKS 조회 대신 테스트 공개키로 검증한다. 검증 규칙은 운영과 같은 것을 쓴다. */
		@Bean
		@Primary
		JwtDecoder testJwtDecoder(JwtProperties props) {
			NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey((RSAPublicKey) KEYS.getPublic()).build();
			decoder.setJwtValidator(SecurityConfig.userTokenValidator(props));
			return decoder;
		}
	}

	@RestController
	static class ProbeController {
		@GetMapping("/api/worklog/probe")
		String probe(CurrentUser user) {
			return user.id().toString();
		}
	}
}

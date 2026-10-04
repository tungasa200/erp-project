package com.erp.identity.token;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;

import org.junit.jupiter.api.Test;

class JwtKeyConfigTest {

	@Test
	void PKCS8_PEM에서_개인키와_공개키를_읽는다_환경변수의_역슬래시n도_줄바꿈으로_본다() throws Exception {
		KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
		generator.initialize(2048);
		var pair = generator.generateKeyPair();
		String body = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(pair.getPrivate().getEncoded());
		String pem = "-----BEGIN PRIVATE KEY-----\\n" + body.replace("\n", "\\n") + "\\n-----END PRIVATE KEY-----";

		var key = JwtKeyConfig.fromPem(pem).keyID("k1").build();

		assertThat(key.isPrivate()).isTrue();
		assertThat(key.toRSAPublicKey().getModulus()).isEqualTo(((RSAPublicKey) pair.getPublic()).getModulus());
	}

	@Test
	void 환경_변수가_없어_자리표시자가_그대로_들어오면_기동에_실패한다() {
		assertThatThrownBy(() -> new JwtProperties("${JWT_PRIVATE_KEY}", "k1"))
			.isInstanceOf(IllegalStateException.class);
		assertThatThrownBy(() -> new JwtProperties("", "${JWT_KEY_ID}")).isInstanceOf(IllegalStateException.class);
		new JwtProperties("", "local"); // 로컬: 키 없음 → 임시 키
	}

	@Test
	void 읽을_수_없는_키면_기동에_실패한다() {
		assertThatThrownBy(() -> JwtKeyConfig.fromPem("not a key")).isInstanceOf(IllegalStateException.class);
	}

}

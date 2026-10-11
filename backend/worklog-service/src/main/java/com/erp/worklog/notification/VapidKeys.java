package com.erp.worklog.notification;

import com.zerodeplibs.webpush.VAPIDKeyPair;
import com.zerodeplibs.webpush.VAPIDKeyPairs;
import com.zerodeplibs.webpush.key.PrivateKeySources;
import com.zerodeplibs.webpush.key.PublicKeySources;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.math.BigInteger;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * 웹 푸시 VAPID 키 (P4-01). 형식은 npx web-push generate-vapid-keys와 같다:
 * 공개 키 base64url 비압축 P-256 점 65바이트, 비밀 키 base64url 32바이트 스칼라.
 * 운영(prod)에서 비어 있으면 기동을 막는다(조용히 푸시가 안 가는 것보다 낫다, D-50). 개발·테스트는 기동할 때 임시 키를 만든다.
 */
@Component
public class VapidKeys {

	private static final Logger log = LoggerFactory.getLogger(VapidKeys.class);

	private final String publicKey;
	private final VAPIDKeyPair keyPair;
	private final String subject;

	VapidKeys(@Value("${worklog.push.vapid-public-key:}") String publicKey,
			@Value("${worklog.push.vapid-private-key:}") String privateKey,
			@Value("${worklog.push.vapid-subject:https://wy-worklog.com}") String subject, Environment env) {
		this.subject = subject;
		try {
			if (publicKey.isBlank() || privateKey.isBlank()) {
				if (env.matchesProfiles("prod")) {
					throw new IllegalStateException("prod 프로필에는 VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY가 필요합니다.");
				}
				log.warn("VAPID 키가 없어 임시 키를 만든다. 재기동하면 바뀌어 기존 푸시 구독은 쓸 수 없다(개발용).");
				KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
				generator.initialize(new ECGenParameterSpec("secp256r1"));
				var generated = generator.generateKeyPair();
				ECPublicKey pub = (ECPublicKey) generated.getPublic();
				this.publicKey = encode(uncompressed(pub.getW()));
				this.keyPair = VAPIDKeyPairs.of(PrivateKeySources.ofECPrivateKey((ECPrivateKey) generated.getPrivate()),
						PublicKeySources.ofECPublicKey(pub));
				return;
			}
			byte[] pubBytes = Base64.getUrlDecoder().decode(publicKey.trim());
			byte[] d = Base64.getUrlDecoder().decode(privateKey.trim());
			if (pubBytes.length != 65 || pubBytes[0] != 0x04 || d.length != 32) {
				throw new IllegalStateException("VAPID 키 형식이 아닙니다(공개 키 65바이트, 비밀 키 32바이트 base64url).");
			}
			AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
			params.init(new ECGenParameterSpec("secp256r1"));
			ECParameterSpec spec = params.getParameterSpec(ECParameterSpec.class);
			ECPrivateKey priv = (ECPrivateKey) KeyFactory.getInstance("EC")
				.generatePrivate(new ECPrivateKeySpec(new BigInteger(1, d), spec));
			this.publicKey = encode(pubBytes);
			this.keyPair = VAPIDKeyPairs.of(PrivateKeySources.ofECPrivateKey(priv), PublicKeySources.ofUncompressedBytes(pubBytes));
		} catch (GeneralSecurityException | IllegalArgumentException e) {
			throw new IllegalStateException("VAPID 키를 읽지 못했습니다.", e);
		}
	}

	/** PushManager.subscribe의 applicationServerKey (base64url 비압축 65바이트). */
	public String publicKey() {
		return publicKey;
	}

	VAPIDKeyPair keyPair() {
		return keyPair;
	}

	String subject() {
		return subject;
	}

	private static byte[] uncompressed(ECPoint w) {
		byte[] out = new byte[65];
		out[0] = 0x04;
		copy32(w.getAffineX(), out, 1);
		copy32(w.getAffineY(), out, 33);
		return out;
	}

	/** BigInteger는 부호 바이트가 붙거나 앞 0이 빠질 수 있어 32바이트로 맞춘다. */
	private static void copy32(BigInteger value, byte[] out, int offset) {
		byte[] raw = value.toByteArray();
		byte[] trimmed = raw.length > 32 ? Arrays.copyOfRange(raw, raw.length - 32, raw.length) : raw;
		System.arraycopy(trimmed, 0, out, offset + 32 - trimmed.length, trimmed.length);
	}

	private static String encode(byte[] bytes) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}
}

package com.erp.worklog.notification;

import com.zerodeplibs.webpush.PushSubscription;
import com.zerodeplibs.webpush.httpclient.StandardHttpClientRequestPreparer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.math.BigInteger;
import java.net.http.HttpRequest;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class VapidKeysTest {

	static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

	@Test
	void web_push_형식_키를_읽어_서명하고_암호화한_요청을_만든다() throws Exception {
		var server = generate();
		byte[] pub = uncompressed((ECPublicKey) server.getPublic());
		byte[] d = fixed32(((ECPrivateKey) server.getPrivate()).getS());
		VapidKeys keys = new VapidKeys(B64.encodeToString(pub), B64.encodeToString(d), "https://wy-worklog.com",
				new MockEnvironment().withProperty("spring.profiles.active", "prod"));
		assertThat(keys.publicKey()).isEqualTo(B64.encodeToString(pub)).hasSize(87);

		var browser = generate();
		PushSubscription s = new PushSubscription();
		s.setEndpoint("https://fcm.googleapis.com/fcm/send/abc");
		PushSubscription.Keys k = new PushSubscription.Keys();
		k.setP256dh(B64.encodeToString(uncompressed((ECPublicKey) browser.getPublic())));
		k.setAuth(B64.encodeToString(new byte[16]));
		s.setKeys(k);
		HttpRequest request = StandardHttpClientRequestPreparer.getBuilder().pushSubscription(s)
			.vapidJWTExpiresAfter(15, TimeUnit.MINUTES).vapidJWTSubject(keys.subject())
			.pushMessage("{}").ttl(1, TimeUnit.HOURS).build(keys.keyPair()).toRequest();
		assertThat(request.headers().firstValue("Authorization")).get().asString()
			.startsWith("vapid t=").endsWith("k=" + keys.publicKey());
		assertThat(request.headers().firstValue("Content-Encoding")).contains("aes128gcm");
	}

	@Test
	void 운영에서_키가_없으면_기동을_막고_개발에서는_임시_키를_만든다() {
		MockEnvironment prod = new MockEnvironment();
		prod.setActiveProfiles("prod");
		assertThatThrownBy(() -> new VapidKeys("", "", "https://wy-worklog.com", prod))
			.isInstanceOf(IllegalStateException.class).hasMessageContaining("VAPID_PUBLIC_KEY");
		assertThat(new VapidKeys("", "", "https://wy-worklog.com", new MockEnvironment()).publicKey()).hasSize(87);
		assertThatThrownBy(() -> new VapidKeys("abc", "def", "https://wy-worklog.com", new MockEnvironment()))
			.isInstanceOf(IllegalStateException.class);
	}

	@Test
	void 푸시_endpoint는_https의_알려진_서비스만_허용한다() {
		assertThat(PushController.allowed("https://fcm.googleapis.com/fcm/send/x")).isTrue();
		assertThat(PushController.allowed("https://db5p.notify.windows.com/w/?token=x")).isTrue();
		assertThat(PushController.allowed("https://web.push.apple.com/x")).isTrue();
		assertThat(PushController.allowed("https://api.push.apple.com/x")).isTrue();
		assertThat(PushController.allowed("https://notify.windows.com.evil.example/x")).isFalse();
		assertThat(PushController.allowed("https://evilnotify.windows.com/x")).isFalse();
		assertThat(PushController.allowed("https://fcm.googleapis.com:8443/x")).isFalse();
		assertThat(PushController.allowed("https://user@fcm.googleapis.com/x")).isFalse();
		assertThat(PushController.allowed("http://fcm.googleapis.com/x")).isFalse();
		assertThat(PushController.allowed("not a uri")).isFalse();
	}

	private static java.security.KeyPair generate() throws Exception {
		KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
		g.initialize(new ECGenParameterSpec("secp256r1"));
		return g.generateKeyPair();
	}

	private static byte[] uncompressed(ECPublicKey key) {
		byte[] out = new byte[65];
		out[0] = 4;
		System.arraycopy(fixed32(key.getW().getAffineX()), 0, out, 1, 32);
		System.arraycopy(fixed32(key.getW().getAffineY()), 0, out, 33, 32);
		return out;
	}

	private static byte[] fixed32(BigInteger v) {
		byte[] raw = v.toByteArray();
		byte[] t = raw.length > 32 ? Arrays.copyOfRange(raw, raw.length - 32, raw.length) : raw;
		byte[] out = new byte[32];
		System.arraycopy(t, 0, out, 32 - t.length, t.length);
		return out;
	}
}

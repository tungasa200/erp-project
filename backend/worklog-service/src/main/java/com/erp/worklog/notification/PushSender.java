package com.erp.worklog.notification;

import com.erp.worklog.notification.PushSubscriptionRepository.Subscription;
import com.zerodeplibs.webpush.PushSubscription;
import com.zerodeplibs.webpush.httpclient.StandardHttpClientRequestPreparer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 웹 푸시 발송 (P4-01). 메시지는 VAPID로 서명하고 구독 키로 암호화한다(RFC 8291·8292, 라이브러리가 처리).
 * 트랜잭션 밖에서 부른다(푸시 서비스 응답을 기다리는 동안 DB 연결을 잡지 않도록).
 */
@Component
public class PushSender {

	private static final Logger log = LoggerFactory.getLogger(PushSender.class);
	private static final Duration TIMEOUT = Duration.ofSeconds(10);

	/** 서비스 워커가 받는 내용. 기록·업무 제목 같은 내용은 넣지 않는다. */
	public record Message(String type, UUID notificationId, String title, String body, String url) {
	}

	private final PushSubscriptionRepository subscriptions;
	private final VapidKeys keys;
	private final JsonMapper json;
	private final HttpClient http;

	PushSender(PushSubscriptionRepository subscriptions, VapidKeys keys, JsonMapper json) {
		this.subscriptions = subscriptions;
		this.keys = keys;
		this.json = json;
		this.http = HttpClient.newBuilder().connectTimeout(TIMEOUT).followRedirects(HttpClient.Redirect.NEVER).build();
	}

	/** 사용자의 모든 구독에 보낸다. 실패는 기록만 하고 넘어간다(앱 안 알림은 이미 만들어졌다). 보낸 수를 돌려준다. */
	public int send(UUID ownerId, Message message) {
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("type", message.type());
		payload.put("notificationId", message.notificationId());
		payload.put("title", message.title());
		payload.put("body", message.body());
		payload.put("url", message.url());
		byte[] body = json.writeValueAsBytes(payload);
		int sent = 0;
		for (Subscription s : subscriptions.findByOwner(ownerId)) {
			if (send(s, message.type(), body)) {
				sent++;
			}
		}
		return sent;
	}

	private boolean send(Subscription s, String topic, byte[] body) {
		PushSubscription target = new PushSubscription();
		target.setEndpoint(s.endpoint());
		PushSubscription.Keys k = new PushSubscription.Keys();
		k.setP256dh(s.p256dh());
		k.setAuth(s.auth());
		target.setKeys(k);
		try {
			HttpRequest request = StandardHttpClientRequestPreparer.getBuilder()
				.pushSubscription(target)
				.vapidJWTExpiresAfter(15, TimeUnit.MINUTES)
				.vapidJWTSubject(keys.subject())
				.pushMessage(body)
				.ttl(1, TimeUnit.HOURS)
				.urgencyNormal()
				.topic(topic.replace("_", "-").toLowerCase()) // 같은 종류는 아직 안 받은 앞 메시지를 대체한다
				.build(keys.keyPair())
				.toRequestBuilder()
				.timeout(TIMEOUT)
				.build();
			int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
			if (status == 404 || status == 410) {
				subscriptions.deleteGone(s.endpoint());
				log.info("푸시 구독이 만료되어 지웠다 (status {})", status);
				return false;
			}
			if (status / 100 != 2) {
				log.warn("웹 푸시 실패 status {}", status);
				return false;
			}
			return true;
		} catch (IOException | RuntimeException e) {
			// 잘못 저장된 키(형식 오류)도 여기로 온다
			log.warn("웹 푸시 발송 오류: {}", e.toString());
			return false;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return false;
		}
	}
}

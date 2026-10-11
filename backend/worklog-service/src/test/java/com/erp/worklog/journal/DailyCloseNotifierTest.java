package com.erp.worklog.journal;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.notification.PushSender;
import com.erp.worklog.notification.PushSender.Message;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserDataPurger;
import com.erp.worklog.user.UserProfileService;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 하루 마감 알림·알림 센터·푸시 구독 (P4-01, 카드 0401). 지금 = 2026-10-07(수) 15:00 KST, ALICE는 Asia/Seoul.
 * 2026-10-09(금)은 한글날이라 그 주 마지막 근무일은 10-08(목)이다.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-", "worklog.notify.initial-delay=1h", "worklog.notification.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, DailyCloseNotifierTest.FixedClock.class })
class DailyCloseNotifierTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a9");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b9");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");
	static final String FCM = "https://fcm.googleapis.com/fcm/send/abc";

	@TestConfiguration
	static class FixedClock {
		@Bean
		@Primary
		Clock fixedClock() {
			return Clock.fixed(NOW, ZoneOffset.UTC);
		}
	}

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@Autowired
	DailyCloseNotifier notifier;
	@Autowired
	UserProfileService profiles;
	@Autowired
	UserDataPurger purger;
	@MockitoBean
	IdentityClient identity;
	@MockitoBean
	PushSender push;

	@BeforeEach
	void reset() {
		cleanUp();
		for (UUID u : new UUID[] { ALICE, BOB }) {
			jdbc.sql("""
					INSERT INTO user_snapshot (user_id, timezone, week_start, work_days, last_seq, synced_at)
					VALUES (?, 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(u).update();
		}
	}

	@AfterEach
	void cleanUp() {
		for (String table : new String[] { "notification", "push_subscription", "work_log", "user_setting" }) {
			jdbc.sql("DELETE FROM " + table + " WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		}
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 알림은_기본_꺼짐이고_켜면_다음_근무일_마감_시각이_잡힌다() throws Exception {
		send(ALICE, get("/api/worklog/me"), "").andExpect(jsonPath("$.settings.dailyCloseNotifyEnabled").value(false));

		enable(ALICE);
		assertThat(nextNotifyAt(ALICE)).isEqualTo(Instant.parse("2026-10-07T09:00:00Z")); // 오늘 18:00 KST
		// 마감 시각이 이미 지났으면 다음 근무일(목). 금요일은 한글날
		send(ALICE, patch("/api/worklog/me/settings"), "{\"version\":0,\"dailyCloseTime\":\"14:00\"}")
			.andExpect(status().isOk()).andExpect(jsonPath("$.dailyCloseNotifyEnabled").value(true));
		assertThat(nextNotifyAt(ALICE)).isEqualTo(Instant.parse("2026-10-08T05:00:00Z"));

		send(ALICE, patch("/api/worklog/me/settings"), "{\"version\":1,\"dailyCloseNotifyEnabled\":false}").andExpect(status().isOk());
		assertThat(nextNotifyAt(ALICE)).isNull();
	}

	@Test
	void 프로필_시간대가_바뀌면_다음_알림_시각을_다시_계산한다() throws Exception {
		enable(ALICE);
		when(identity.me("token")).thenReturn(new Profile("앨리스", null, null, "UTC", "MONDAY", 31, 1));
		profiles.refresh(ALICE, "token");
		assertThat(nextNotifyAt(ALICE)).isEqualTo(Instant.parse("2026-10-07T18:00:00Z"));
	}

	@Test
	void 마감_시각이_지나면_알림을_만들고_푸시하고_다음_근무일로_옮긴다() throws Exception {
		enable(ALICE);
		// 월~수만 근무 → 수요일이 그 주 마지막 근무일
		jdbc.sql("UPDATE user_snapshot SET work_days = 7 WHERE user_id = ?").param(ALICE).update();
		setNext(ALICE, "2026-10-07T05:30:00Z");

		notifier.run();

		ArgumentCaptor<Message> sent = ArgumentCaptor.forClass(Message.class);
		verify(push).send(eq(ALICE), sent.capture());
		assertThat(sent.getValue().title()).isEqualTo("하루 마감 시간이에요");
		assertThat(sent.getValue().body()).isNull(); // 확인 대기 0건
		assertThat(sent.getValue().url()).isEqualTo("/logs/daily/2026-10-07?close=1");
		assertThat(nextNotifyAt(ALICE)).isEqualTo(Instant.parse("2026-10-12T09:00:00Z"));

		send(ALICE, get("/api/worklog/notifications"), "")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.unreadCount").value(2))
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[?(@.type == 'DAILY_CLOSE')].pendingCount").value(0))
			.andExpect(jsonPath("$.items[?(@.type == 'DAILY_CLOSE')].id").value(sent.getValue().notificationId().toString()))
			.andExpect(jsonPath("$.items[?(@.type == 'LOG_SUGGESTION')].logType").value("WEEKLY"))
			.andExpect(jsonPath("$.items[?(@.type == 'LOG_SUGGESTION')].periodStart").value("2026-10-05"));

		// 같은 날 다시 돌아도 한 번만
		clearInvocations(push);
		setNext(ALICE, "2026-10-07T05:30:00Z");
		notifier.run();
		verify(push, never()).send(any(), any());
		assertThat(count(ALICE)).isEqualTo(2);
	}

	@Test
	void 일간_일지를_확정했거나_한_시간_넘게_늦었으면_보내지_않는다() throws Exception {
		enable(ALICE);
		enable(BOB);
		jdbc.sql("""
				INSERT INTO work_log (id, owner_id, type, period_start, period_end, status, content, confirmed_at, version, created_at, updated_at)
				VALUES (?, ?, 'DAILY', '2026-10-07', '2026-10-07', 'CONFIRMED', '{}'::jsonb, now(), 0, now(), now())""")
			.params(UUID.randomUUID(), ALICE).update();
		setNext(ALICE, "2026-10-07T05:30:00Z");
		setNext(BOB, "2026-10-07T04:00:00Z"); // 2시간 늦음

		notifier.run();

		verify(push, never()).send(any(), any());
		assertThat(count(ALICE) + count(BOB)).isZero();
		// 보내지 않아도 다음 시각은 그날 마감 뒤의 근무일로 옮긴다
		assertThat(nextNotifyAt(ALICE)).isEqualTo(Instant.parse("2026-10-08T09:00:00Z"));
		assertThat(nextNotifyAt(BOB)).isEqualTo(Instant.parse("2026-10-08T09:00:00Z"));
	}

	@Test
	void 알림_센터는_최신순_cursor와_읽음_처리를_한다() throws Exception {
		insertNotification(ALICE, "2026-10-05", "2026-10-05T09:00:00Z");
		insertNotification(ALICE, "2026-10-06", "2026-10-06T09:00:00Z");
		String bobs = insertNotification(BOB, "2026-10-06", "2026-10-06T09:00:00Z");

		String body = send(ALICE, get("/api/worklog/notifications?limit=1"), "")
			.andExpect(jsonPath("$.items[0].date").value("2026-10-06"))
			.andExpect(jsonPath("$.unreadCount").value(2))
			.andReturn().getResponse().getContentAsString();
		String cursor = JsonPath.read(body, "$.nextCursor");
		String first = JsonPath.read(body, "$.items[0].id");
		send(ALICE, get("/api/worklog/notifications?limit=1&cursor=" + cursor), "")
			.andExpect(jsonPath("$.items[0].date").value("2026-10-05"))
			.andExpect(jsonPath("$.nextCursor").isEmpty());
		send(ALICE, get("/api/worklog/notifications?cursor=@@"), "")
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
		send(ALICE, get("/api/worklog/notifications?limit=0"), "").andExpect(status().isBadRequest());

		send(ALICE, post("/api/worklog/notifications/" + first + "/read"), "").andExpect(status().isNoContent());
		send(ALICE, post("/api/worklog/notifications/" + first + "/read"), "").andExpect(status().isNoContent());
		send(ALICE, post("/api/worklog/notifications/" + bobs + "/read"), "").andExpect(status().isNotFound());
		send(ALICE, get("/api/worklog/notifications"), "").andExpect(jsonPath("$.unreadCount").value(1));
		send(ALICE, post("/api/worklog/notifications/read-all"), "").andExpect(status().isNoContent());
		send(ALICE, get("/api/worklog/notifications"), "").andExpect(jsonPath("$.unreadCount").value(0));
		send(BOB, get("/api/worklog/notifications"), "").andExpect(jsonPath("$.unreadCount").value(1));
	}

	@Test
	void 푸시_구독은_알려진_서비스만_받고_사용자당_10개까지_둔다() throws Exception {
		send(ALICE, get("/api/worklog/push/public-key"), "")
			.andExpect(status().isOk()).andExpect(jsonPath("$.publicKey").value(org.hamcrest.Matchers.hasLength(87)));

		subscribe(ALICE, FCM).andExpect(status().isNoContent());
		subscribe(ALICE, "https://evil.example/push").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errors[0].field").value("endpoint")).andExpect(jsonPath("$.errors[0].code").value("NOT_ALLOWED"));
		subscribe(ALICE, "http://fcm.googleapis.com/x").andExpect(status().isBadRequest());
		subscribe(ALICE, "https://wns2-sg2p.notify.windows.com/w/?token=x").andExpect(status().isNoContent());

		// 같은 브라우저에서 BOB으로 바꾸면 구독이 BOB으로 옮겨간다
		subscribe(BOB, FCM).andExpect(status().isNoContent());
		assertThat(subscriptions(ALICE)).isEqualTo(1);
		assertThat(subscriptions(BOB)).isEqualTo(1);

		for (int i = 0; i < 11; i++) {
			subscribe(ALICE, "https://web.push.apple.com/" + i).andExpect(status().isNoContent());
		}
		assertThat(subscriptions(ALICE)).isEqualTo(10);

		send(ALICE, delete("/api/worklog/push/subscriptions?endpoint=" + FCM), "").andExpect(status().isNoContent());
		assertThat(subscriptions(BOB)).isEqualTo(1); // 남의 구독은 지우지 않는다
	}

	@Test
	void 탈퇴_파기는_알림과_푸시_구독도_지운다() throws Exception {
		insertNotification(ALICE, "2026-10-06", "2026-10-06T09:00:00Z");
		subscribe(ALICE, FCM).andExpect(status().isNoContent());
		purger.purge(ALICE);
		assertThat(count(ALICE)).isZero();
		assertThat(subscriptions(ALICE)).isZero();
	}

	private void enable(UUID owner) throws Exception {
		send(owner, patch("/api/worklog/me/settings"), "{\"version\":0,\"dailyCloseNotifyEnabled\":true}")
			.andExpect(status().isOk()).andExpect(jsonPath("$.dailyCloseNotifyEnabled").value(true));
	}

	private ResultActions subscribe(UUID owner, String endpoint) throws Exception {
		return send(owner, put("/api/worklog/push/subscriptions"),
				"{\"endpoint\":\"" + endpoint + "\",\"keys\":{\"p256dh\":\"BPk\",\"auth\":\"au\"}}");
	}

	private String insertNotification(UUID owner, String date, String createdAt) {
		UUID id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO notification (id, owner_id, type, date, pending_count, created_at)
				VALUES (?, ?, 'DAILY_CLOSE', ?::date, 0, ?::timestamptz)""")
			.params(id, owner, date, createdAt).update();
		return id.toString();
	}

	private void setNext(UUID owner, String at) {
		jdbc.sql("UPDATE user_setting SET next_notify_at = ?::timestamptz WHERE owner_id = ?").params(at, owner).update();
	}

	private Instant nextNotifyAt(UUID owner) {
		return jdbc.sql("SELECT next_notify_at FROM user_setting WHERE owner_id = ?").param(owner)
			.query(OffsetDateTime.class).optional().map(OffsetDateTime::toInstant).orElse(null);
	}

	private int count(UUID owner) {
		return jdbc.sql("SELECT count(*) FROM notification WHERE owner_id = ?").param(owner).query(Integer.class).single();
	}

	private int subscriptions(UUID owner) {
		return jdbc.sql("SELECT count(*) FROM push_subscription WHERE owner_id = ?").param(owner).query(Integer.class).single();
	}

	private ResultActions send(UUID owner, MockHttpServletRequestBuilder request, String body) throws Exception {
		return mvc.perform(request.with(user(owner)).contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private static RequestPostProcessor user(UUID id) {
		return jwt().jwt(j -> j.subject(id.toString()));
	}
}

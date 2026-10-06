package com.erp.identity.feed;

import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import com.nimbusds.jwt.SignedJWT;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.erp.identity.PostgresTestConfig;
import com.erp.identity.user.UserDeletionService;

/**
 * 서비스 토큰 발급과 /internal/** (P0-11). 클라이언트는 application.yml의 로컬 기본값(worklog)을 쓴다.
 * 테스트끼리 DB를 공유하므로 피드는 테스트 시작 시점의 최신 seq 이후만 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class InternalApiTest {

	static final String LOCAL_SECRET = "worklog-local-secret";

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	JsonMapper json;

	@Autowired
	UserDeletionService deletion;

	@Autowired
	CleanupJobs cleanup;

	@Test
	void 서비스_토큰은_aud_erp_internal과_허용된_scope로_발급한다() throws Exception {
		String body = mvc
			.perform(post("/internal/oauth/token").header("Authorization", basic("worklog", LOCAL_SECRET))
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("grant_type", "client_credentials"))
			.andExpect(status().isOk())
			.andExpect(header().string("Cache-Control", "no-store"))
			.andExpect(jsonPath("$.token_type").value("Bearer"))
			.andExpect(jsonPath("$.expires_in").value(300))
			.andReturn()
			.getResponse()
			.getContentAsString();
		var claims = SignedJWT.parse(json.readTree(body).get("access_token").asString()).getJWTClaimsSet();
		assertThat(claims.getAudience()).containsExactly("erp-internal");
		assertThat(claims.getSubject()).isEqualTo("service:worklog");
		assertThat(claims.getStringClaim("scope")).isEqualTo("user-events:read users:read");
	}

	@Test
	void 토큰_발급_오류는_RFC6749_형식이다() throws Exception {
		mvc.perform(post("/internal/oauth/token").header("Authorization", basic("worklog", "wrong"))
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.param("grant_type", "client_credentials"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.error").value("invalid_client"));
		mvc.perform(post("/internal/oauth/token").header("Authorization", basic("nobody", LOCAL_SECRET))
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.param("grant_type", "client_credentials"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.error").value("invalid_client"));
		mvc.perform(post("/internal/oauth/token").header("Authorization", basic("worklog", LOCAL_SECRET))
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.param("grant_type", "password"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error").value("unsupported_grant_type"));
		mvc.perform(post("/internal/oauth/token").header("Authorization", basic("worklog", LOCAL_SECRET))
			.contentType(MediaType.APPLICATION_FORM_URLENCODED)
			.param("grant_type", "client_credentials")
			.param("scope", "users:read admin"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.error").value("invalid_scope"));
	}

	@Test
	void 피드는_after_이후_이벤트를_seq_순으로_주고_탈퇴는_프로필_없이_준다() throws Exception {
		long head = head();
		UUID first = userId(signup(mvc, newEmail()).getContentAsString());
		UUID second = userId(signup(mvc, newEmail()).getContentAsString());
		deletion.delete(first);

		String token = serviceToken("user-events:read");
		JsonNode page1 = getJson("/internal/user-events?after=" + head + "&limit=1", token);
		assertThat(page1.get("hasMore").asBoolean()).isTrue();
		long cursor = page1.get("items").get(0).get("seq").asLong();

		// first의 CREATED는 탈퇴로 지워져 second의 CREATED가 먼저 온다
		JsonNode created = page1.get("items").get(0);
		assertThat(created.get("type").asString()).isEqualTo("CREATED");
		assertThat(created.get("userId").asString()).isEqualTo(second.toString());
		assertThat(created.get("profile").get("timezone").asString()).isEqualTo("Asia/Seoul");
		assertThat(created.get("profile").get("workDays").asInt()).isEqualTo(31);

		JsonNode page2 = getJson("/internal/user-events?after=" + cursor, token);
		assertThat(page2.get("hasMore").asBoolean()).isFalse();
		JsonNode deleted = page2.get("items").get(0);
		assertThat(deleted.get("type").asString()).isEqualTo("DELETED");
		assertThat(deleted.get("userId").asString()).isEqualTo(first.toString());
		assertThat(deleted.get("profile").isNull()).isTrue();
		assertThat(deleted.get("seq").asLong()).isGreaterThan(cursor);
	}

	@Test
	void 내부_API는_필요한_scope의_서비스_토큰만_받는다() throws Exception {
		mvc.perform(get("/internal/user-events?after=0"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
		// 사용자 토큰(aud=erp-api)은 거부
		String userToken = cookieValue(signup(mvc, newEmail()), "access_token");
		mvc.perform(get("/internal/user-events?after=0").header("Authorization", "Bearer " + userToken))
			.andExpect(status().isUnauthorized());
		// scope 부족
		mvc.perform(get("/internal/user-events?after=0").header("Authorization",
				"Bearer " + serviceToken("users:read")))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("INSUFFICIENT_SCOPE"));
		mvc.perform(get("/internal/users").header("Authorization", "Bearer " + serviceToken("user-events:read")))
			.andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("INSUFFICIENT_SCOPE"));
	}

	@Test
	void 잘못된_cursor와_범위_밖_파라미터는_400() throws Exception {
		String token = serviceToken("users:read user-events:read");
		mvc.perform(get("/internal/users?cursor=garbage").header("Authorization", "Bearer " + token))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
		mvc.perform(get("/internal/deleted-users?cursor=garbage").header("Authorization", "Bearer " + token))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
		mvc.perform(get("/internal/users?limit=501").header("Authorization", "Bearer " + token))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("BAD_REQUEST"));
		mvc.perform(get("/internal/user-events").header("Authorization", "Bearer " + token))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("BAD_REQUEST"));
		mvc.perform(get("/internal/user-events?after=-1").header("Authorization", "Bearer " + token))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("BAD_REQUEST"));
	}

	@Test
	void 피드와_전체_목록의_프로필에_version을_담고_P1_01_이전_이벤트는_0으로_준다() throws Exception {
		long head = head();
		UUID userId = userId(signup(mvc, newEmail()).getContentAsString());
		UUID legacyUser = UUID.randomUUID();
		jdbc.update("INSERT INTO user_events (type, user_id, payload, created_at) VALUES ('CREATED', ?, ?::jsonb, now())",
				legacyUser, """
						{"name":null,"organization":null,"position":null,"timezone":"Asia/Seoul","weekStart":"MONDAY","workDays":31}""");

		JsonNode items = getJson("/internal/user-events?after=" + head, serviceToken("user-events:read")).get("items");
		assertThat(items).hasSize(2);
		assertThat(items.get(0).get("userId").asString()).isEqualTo(userId.toString());
		assertThat(items.get(0).get("profile").get("version").asLong()).isZero();
		assertThat(items.get(1).get("userId").asString()).isEqualTo(legacyUser.toString());
		assertThat(items.get(1).get("profile").get("version").isIntegralNumber()).isTrue();
		assertThat(items.get(1).get("profile").get("version").asLong()).isZero();
	}

	@Test
	void 보관_기간이_지난_커서는_410() throws Exception {
		long head = head();
		jdbc.update("UPDATE feed_retention SET pruned_through = ? WHERE id = 1", head + 1);
		try {
			mvc.perform(get("/internal/user-events?after=" + head).header("Authorization",
					"Bearer " + serviceToken("user-events:read")))
				.andExpect(status().isGone())
				.andExpect(jsonPath("$.code").value("FEED_CURSOR_EXPIRED"));
		}
		finally {
			jdbc.update("UPDATE feed_retention SET pruned_through = ? WHERE id = 1", head);
		}
	}

	@Test
	void 전체_사용자_목록은_페이지가_바뀌어도_같은_asOfSeq를_준다() throws Exception {
		signup(mvc, newEmail());
		signup(mvc, newEmail());
		String token = serviceToken("users:read");
		long expectedAsOf = head();

		List<String> ids = new ArrayList<>();
		JsonNode page = getJson("/internal/users?limit=1", token);
		assertThat(page.get("asOfSeq").asLong()).isEqualTo(expectedAsOf);
		// 첫 페이지 뒤에 한 번만 가입한다. 새 ID(UUIDv7)는 항상 커서 뒤라 매 페이지마다 가입하면 끝나지 않는다.
		signup(mvc, newEmail());
		while (true) {
			assertThat(page.get("asOfSeq").asLong()).isEqualTo(expectedAsOf);
			page.get("items").forEach(item -> {
				ids.add(item.get("userId").asString());
				assertThat(item.get("profile").get("weekStart").asString()).isEqualTo("MONDAY");
			});
			if (page.get("nextCursor").isNull()) {
				break;
			}
			page = getJson("/internal/users?limit=1&cursor=" + page.get("nextCursor").asString(), token);
		}
		assertThat(ids).doesNotHaveDuplicates().isSorted();
		assertThat(ids.size()).isGreaterThanOrEqualTo(2);
	}

	@Test
	void 탈퇴_기록_목록() throws Exception {
		UUID userId = userId(signup(mvc, newEmail()).getContentAsString());
		deletion.delete(userId);

		List<String> ids = new ArrayList<>();
		String token = serviceToken("users:read");
		String cursor = null;
		do {
			JsonNode page = getJson("/internal/deleted-users?limit=2" + (cursor == null ? "" : "&cursor=" + cursor),
					token);
			page.get("items").forEach(item -> ids.add(item.get("userId").asString()));
			cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asString();
		}
		while (cursor != null);
		assertThat(ids).contains(userId.toString()).isSorted();
	}

	@Test
	void 정리_작업은_30일_지난_피드와_만료된_Refresh_Token을_지운다() throws Exception {
		long before = head();
		UUID userId = UUID.randomUUID();
		jdbc.update("INSERT INTO user_events (type, user_id, created_at) VALUES ('DELETED', ?, now() - interval '31 days')",
				userId);
		long oldSeq = head();
		String refreshToken = cookieValue(signup(mvc, newEmail()), "refresh_token");
		jdbc.update("UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = encode(sha256(?::bytea), 'hex')",
				refreshToken);

		cleanup.pruneUserFeed();
		cleanup.purgeExpiredRefreshTokens();

		assertThat(jdbc.queryForObject("SELECT pruned_through FROM feed_retention", Long.class)).isEqualTo(oldSeq);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM user_events WHERE seq <= ?", Long.class, oldSeq))
			.isZero();
		assertThat(oldSeq).isGreaterThan(before);
		// 가입 이벤트(oldSeq 뒤)는 남는다
		assertThat(jdbc.queryForObject("SELECT count(*) FROM user_events WHERE seq > ?", Long.class, oldSeq))
			.isEqualTo(1);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE expires_at < now()", Long.class))
			.isZero();
	}

	private long head() {
		return jdbc.queryForObject("""
				SELECT GREATEST(COALESCE((SELECT max(seq) FROM user_events), 0), pruned_through)
				FROM feed_retention WHERE id = 1
				""", Long.class);
	}

	private String serviceToken(String scope) throws Exception {
		String body = mvc
			.perform(post("/internal/oauth/token").header("Authorization", basic("worklog", LOCAL_SECRET))
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("grant_type", "client_credentials")
				.param("scope", scope))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
		return json.readTree(body).get("access_token").asString();
	}

	private JsonNode getJson(String url, String token) throws Exception {
		return json.readTree(mvc.perform(get(url).header("Authorization", "Bearer " + token))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString());
	}

	private UUID userId(String meJson) {
		return UUID.fromString(json.readTree(meJson).get("id").asString());
	}

	private static String basic(String id, String secret) {
		return "Basic " + Base64.getEncoder().encodeToString((id + ":" + secret).getBytes(StandardCharsets.UTF_8));
	}

}

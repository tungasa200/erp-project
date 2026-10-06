package com.erp.identity.user;

import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.erp.identity.PostgresTestConfig;

/** PATCH /api/users/me (P1-01, contracts/identity.yaml updateMe). */
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class ProfileUpdateTest {

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	JsonMapper json;

	@Test
	void 보낸_칸만_바꾸고_version을_올리며_피드에_전체_프로필을_남긴다() throws Exception {
		Account a = newAccount();

		JsonNode me = body(patchMe(a, """
				{"version":0,"name":"  김하늘 ","organization":"개발팀","workDays":63}"""));

		assertThat(me.get("name").asString()).isEqualTo("김하늘");
		assertThat(me.get("organization").asString()).isEqualTo("개발팀");
		assertThat(me.get("position").isNull()).isTrue();
		assertThat(me.get("workDays").asInt()).isEqualTo(63);
		assertThat(me.get("timezone").asString()).isEqualTo("Asia/Seoul");
		assertThat(me.get("version").asLong()).isEqualTo(1);

		JsonNode payload = json.readTree(jdbc.queryForObject(
				"SELECT payload::text FROM user_events WHERE user_id = ? AND type = 'PROFILE_UPDATED'", String.class,
				a.id));
		assertThat(payload.get("name").asString()).isEqualTo("김하늘");
		assertThat(payload.get("workDays").asInt()).isEqualTo(63);
		assertThat(payload.get("version").asLong()).isEqualTo(1);
		assertThat(payload.has("keyboardShortcutsEnabled")).isFalse();

		// 빈 문자열과 null은 지운다
		me = body(patchMe(a, """
				{"version":1,"name":"","organization":null}"""));
		assertThat(me.get("name").isNull()).isTrue();
		assertThat(me.get("organization").isNull()).isTrue();
		assertThat(me.get("version").asLong()).isEqualTo(2);
	}

	@Test
	void version이_다르면_409이고_아무것도_바꾸지_않는다() throws Exception {
		Account a = newAccount();
		patchMe(a, "{\"version\":0,\"name\":\"처음\"}").andExpect(status().isOk());

		patchMe(a, "{\"version\":0,\"name\":\"다른 탭\"}").andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));

		mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + a.token))
			.andExpect(jsonPath("$.name").value("처음"))
			.andExpect(jsonPath("$.version").value(1));
	}

	@Test
	void 바뀐_값이_없으면_version도_피드도_그대로다() throws Exception {
		Account a = newAccount();
		patchMe(a, "{\"version\":0,\"timezone\":\"Asia/Seoul\",\"weekStart\":\"MONDAY\"}").andExpect(status().isOk())
			.andExpect(jsonPath("$.version").value(0));
		assertThat(profileEvents(a)).isZero();
	}

	@Test
	void 단축키_설정만_바꾸면_version은_오르고_피드는_남기지_않는다() throws Exception {
		Account a = newAccount();
		patchMe(a, "{\"version\":0,\"keyboardShortcutsEnabled\":false}").andExpect(status().isOk())
			.andExpect(jsonPath("$.keyboardShortcutsEnabled").value(false))
			.andExpect(jsonPath("$.version").value(1));
		assertThat(profileEvents(a)).isZero();
	}

	@Test
	void 칸별_검증_오류를_모두_돌려준다() throws Exception {
		Account a = newAccount();
		patchMe(a, """
				{"name":"%s","timezone":"+09:00","workDays":0,"weekStart":null}""".formatted("가".repeat(101)))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[*].field").value(
					containsInAnyOrder("version", "name", "timezone", "workDays", "weekStart")))
			.andExpect(jsonPath("$.errors[*].code").value(containsInAnyOrder("REQUIRED", "TOO_LONG",
					"TIMEZONE_INVALID", "WORK_DAYS_INVALID", "REQUIRED")));

		patchMe(a, "{\"version\":0,\"workDays\":\"31\"}").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("BAD_REQUEST"));
		// 100자까지는 받는다
		patchMe(a, "{\"version\":0,\"name\":\"%s\"}".formatted("가".repeat(100))).andExpect(status().isOk());
	}

	private record Account(UUID id, String token) {
	}

	private Account newAccount() throws Exception {
		MockHttpServletResponse response = signup(mvc, newEmail());
		UUID id = UUID.fromString(json.readTree(response.getContentAsString()).get("id").asString());
		return new Account(id, cookieValue(response, "access_token"));
	}

	private ResultActions patchMe(Account a, String body) throws Exception {
		return mvc.perform(patch("/api/users/me").header("Authorization", "Bearer " + a.token)
			.contentType(MediaType.APPLICATION_JSON)
			.content(body));
	}

	private JsonNode body(ResultActions result) throws Exception {
		return json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
	}

	private int profileEvents(Account a) {
		return jdbc.queryForObject("SELECT count(*) FROM user_events WHERE user_id = ? AND type = 'PROFILE_UPDATED'",
				Integer.class, a.id);
	}

}

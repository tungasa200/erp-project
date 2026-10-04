package com.erp.identity.user;

import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.refresh;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

import tools.jackson.databind.json.JsonMapper;

import com.erp.identity.AuthTestSupport;
import com.erp.identity.PostgresTestConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class UserDeletionTest {

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	JsonMapper json;

	@Autowired
	UserDeletionService deletion;

	@Test
	void 탈퇴하면_계정을_지우고_피드에는_DELETED만_남긴다() throws Exception {
		MockHttpServletResponse signedUp = signup(mvc, AuthTestSupport.newEmail());
		UUID userId = UUID.fromString(json.readTree(signedUp.getContentAsString()).get("id").asString());
		String access = cookieValue(signedUp, "access_token");
		String refreshToken = cookieValue(signedUp, "refresh_token");

		deletion.delete(userId);

		assertThat(count("SELECT count(*) FROM users WHERE id = ?", userId)).isZero();
		assertThat(count("SELECT count(*) FROM user_credentials WHERE user_id = ?", userId)).isZero();
		assertThat(count("SELECT count(*) FROM refresh_tokens WHERE user_id = ?", userId)).isZero();
		assertThat(count("SELECT count(*) FROM deleted_users WHERE user_id = ?", userId)).isEqualTo(1);
		assertThat(jdbc.queryForList("SELECT type FROM user_events WHERE user_id = ?", String.class, userId))
			.containsExactly("DELETED");
		assertThat(jdbc.queryForObject("SELECT payload IS NULL FROM user_events WHERE user_id = ?", Boolean.class,
				userId)).isTrue();

		// 남은 Access Token(최대 10분)은 서명이 맞아도 거부한다
		mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + access))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("USER_DELETED"));
		assertThat(refresh(mvc, refreshToken).getStatus()).isEqualTo(401);

		deletion.delete(userId); // 이미 없는 사용자는 아무것도 하지 않는다
		assertThat(count("SELECT count(*) FROM user_events WHERE user_id = ?", userId)).isEqualTo(1);
	}

	@Test
	void 탈퇴한_이메일로_바로_다시_가입하면_새_ID를_받는다() throws Exception {
		String email = AuthTestSupport.newEmail();
		UUID oldId = UUID.fromString(json.readTree(signup(mvc, email).getContentAsString()).get("id").asString());

		deletion.delete(oldId);
		MockHttpServletResponse again = signup(mvc, email);

		assertThat(again.getStatus()).isEqualTo(201);
		UUID newId = UUID.fromString(json.readTree(again.getContentAsString()).get("id").asString());
		assertThat(newId).isNotEqualTo(oldId);
		assertThat(jdbc.queryForList("SELECT type FROM user_events WHERE user_id IN (?, ?) ORDER BY seq",
				String.class, oldId, newId))
			.containsExactly("DELETED", "CREATED");
	}

	private long count(String sql, UUID userId) {
		return jdbc.queryForObject(sql, Long.class, userId);
	}

}

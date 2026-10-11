package com.erp.identity.auth;

import static com.erp.identity.AuthTestSupport.PASSWORD;
import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.setCookie;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;

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

import com.erp.identity.PostgresTestConfig;

/** 회원 탈퇴 API (AUTH-06, P4-05). 삭제 결과(피드·탈퇴 기록)는 UserDeletionTest가 본다. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class AccountDeletionTest {

	private static final String PATH = "/api/users/me/deletion";

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Test
	void 비밀번호가_맞으면_바로_지우고_쿠키를_지운다() throws Exception {
		String email = newEmail();
		String access = cookieValue(signup(mvc, email), "access_token");

		MockHttpServletResponse done = delete(access, PASSWORD).andExpect(status().isNoContent())
			.andReturn()
			.getResponse();

		assertThat(setCookie(done, "access_token")).contains("Max-Age=0");
		assertThat(setCookie(done, "refresh_token")).contains("Max-Age=0", "Path=/api/auth");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE email = ?", Integer.class, email)).isZero();
		delete(access, PASSWORD).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("USER_DELETED"));
	}

	@Test
	void 비밀번호가_틀리면_지우지_않는다() throws Exception {
		String email = newEmail();
		String access = cookieValue(signup(mvc, email), "access_token");

		delete(access, "wrong1234").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("PASSWORD_MISMATCH"))
			.andExpect(jsonPath("$.errors[0].field").value("password"));
		delete(access, "").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].code").value("REQUIRED"));
		assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE email = ?", Integer.class, email)).isOne();
	}

	@Test
	void 틀린_횟수는_비밀번호_변경과_합산한다() throws Exception {
		String access = cookieValue(signup(mvc, newEmail()), "access_token");

		for (int i = 0; i < 3; i++) {
			mvc.perform(post("/api/auth/password-change").contentType(MediaType.APPLICATION_JSON)
				.cookie(new Cookie("access_token", access))
				.content("{\"currentPassword\":\"wrong1234\",\"newPassword\":\"newpass123\"}"))
				.andExpect(status().isBadRequest());
		}
		delete(access, "wrong1234").andExpect(status().isBadRequest());
		delete(access, "wrong1234").andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_LOCKED"));
		delete(access, PASSWORD).andExpect(status().isTooManyRequests());
	}

	@Test
	void 토큰이_없으면_401() throws Exception {
		mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"x\"}"))
			.andExpect(status().isUnauthorized());
	}

	private ResultActions delete(String access, String password) throws Exception {
		return mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON)
			.header("Authorization", "Bearer " + access)
			.content("{\"password\":\"%s\"}".formatted(password)));
	}

}

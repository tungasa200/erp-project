package com.erp.identity.auth;

import static com.erp.identity.AuthTestSupport.PASSWORD;
import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.refresh;
import static com.erp.identity.AuthTestSupport.setCookie;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.erp.identity.PostgresTestConfig;

/** 비밀번호 변경 (AUTH-07, P4-08). */
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class PasswordChangeTest {

	private static final String PATH = "/api/auth/password-change";

	@Autowired
	MockMvc mvc;

	@Test
	void 바꾸면_현재_기기는_유지하고_다른_기기는_로그아웃한다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse here = signup(mvc, email);
		MockHttpServletResponse other = login(email, PASSWORD);

		MockHttpServletResponse done = change(cookieValue(here, "access_token"), cookieValue(here, "refresh_token"),
				PASSWORD, "newpass123")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.currentSessionKept").value(true))
			.andReturn()
			.getResponse();

		assertThat(setCookie(done, "refresh_token")).isNull();
		assertThat(refresh(mvc, cookieValue(here, "refresh_token")).getStatus()).isEqualTo(204);
		assertThat(refresh(mvc, cookieValue(other, "refresh_token")).getStatus()).isEqualTo(401);
		assertThat(login(email, "newpass123").getStatus()).isEqualTo(200);
		assertThat(login(email, PASSWORD).getStatus()).isEqualTo(401);
	}

	@Test
	void refresh_쿠키가_없으면_모든_세션을_끊고_쿠키를_지운다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse here = signup(mvc, email);

		MockHttpServletResponse done = change(cookieValue(here, "access_token"), null, PASSWORD, "newpass123")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.currentSessionKept").value(false))
			.andReturn()
			.getResponse();

		assertThat(setCookie(done, "refresh_token")).contains("Max-Age=0");
		assertThat(setCookie(done, "access_token")).contains("Max-Age=0");
		assertThat(refresh(mvc, cookieValue(here, "refresh_token")).getStatus()).isEqualTo(401);
	}

	@Test
	void 다른_사용자의_refresh_쿠키로는_현재_기기를_유지하지_않는다() throws Exception {
		MockHttpServletResponse me = signup(mvc, newEmail());
		MockHttpServletResponse stranger = signup(mvc, newEmail());

		change(cookieValue(me, "access_token"), cookieValue(stranger, "refresh_token"), PASSWORD, "newpass123")
			.andExpect(jsonPath("$.currentSessionKept").value(false));
		assertThat(refresh(mvc, cookieValue(stranger, "refresh_token")).getStatus()).isEqualTo(204);
	}

	@Test
	void 현재_비밀번호가_틀리면_새_비밀번호_규칙은_보지_않는다() throws Exception {
		MockHttpServletResponse here = signup(mvc, newEmail());

		change(cookieValue(here, "access_token"), cookieValue(here, "refresh_token"), "wrong1234", "short")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("CURRENT_PASSWORD_MISMATCH"))
			.andExpect(jsonPath("$.errors.length()").value(1))
			.andExpect(jsonPath("$.errors[0].field").value("currentPassword"))
			.andExpect(jsonPath("$.errors[0].code").value("CURRENT_PASSWORD_MISMATCH"));
	}

	@Test
	void 새_비밀번호_규칙과_현재와_같음을_모두_알린다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse here = signup(mvc, email);
		String access = cookieValue(here, "access_token");

		change(access, null, PASSWORD, "onlyletters")
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].field").value("newPassword"))
			.andExpect(jsonPath("$.errors[0].code").value("PASSWORD_LETTER_DIGIT_REQUIRED"));
		change(access, null, PASSWORD, PASSWORD).andExpect(jsonPath("$.errors[*].code")
			.value(containsInAnyOrder("PASSWORD_SAME_AS_CURRENT")));
		change(access, null, PASSWORD, "").andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].code").value("REQUIRED"));
		// 실패한 요청은 세션을 건드리지 않는다
		assertThat(refresh(mvc, cookieValue(here, "refresh_token")).getStatus()).isEqualTo(204);
	}

	@Test
	void 다섯번_틀리면_15분_동안_이_기능만_막고_로그인은_된다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse here = signup(mvc, email);
		String access = cookieValue(here, "access_token");

		for (int i = 0; i < 4; i++) {
			change(access, null, "wrong1234", "newpass123").andExpect(status().isBadRequest());
		}
		change(access, null, "wrong1234", "newpass123").andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_LOCKED"))
			.andExpect(header().string("Retry-After", "900"));
		// 잠긴 동안은 맞는 비밀번호도 거부
		change(access, null, PASSWORD, "newpass123").andExpect(status().isTooManyRequests());
		assertThat(login(email, PASSWORD).getStatus()).isEqualTo(200);
	}

	@Test
	void access_token이_없으면_401() throws Exception {
		mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON)
			.content("{\"currentPassword\":\"%s\",\"newPassword\":\"newpass123\"}".formatted(PASSWORD)))
			.andExpect(status().isUnauthorized());
	}

	private ResultActions change(String access, String refreshToken, String current, String next) throws Exception {
		var request = post(PATH).contentType(MediaType.APPLICATION_JSON)
			.content("{\"currentPassword\":\"%s\",\"newPassword\":\"%s\"}".formatted(current, next))
			.cookie(new Cookie("access_token", access));
		if (refreshToken != null) {
			request.cookie(new Cookie("refresh_token", refreshToken));
		}
		return mvc.perform(request);
	}

	private MockHttpServletResponse login(String email, String password) throws Exception {
		return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.header("X-Client-Ip", "10.9." + Math.floorMod(UUID.randomUUID().hashCode(), 250) + ".1")
			.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)))
			.andReturn()
			.getResponse();
	}

}

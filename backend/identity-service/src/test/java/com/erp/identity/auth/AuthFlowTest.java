package com.erp.identity.auth;

import static com.erp.identity.AuthTestSupport.PASSWORD;
import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.refresh;
import static com.erp.identity.AuthTestSupport.setCookie;
import static com.erp.identity.AuthTestSupport.signup;
import static com.erp.identity.AuthTestSupport.signupJson;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

import tools.jackson.databind.json.JsonMapper;

import com.erp.common.test.TestJwt;
import com.erp.identity.PostgresTestConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class AuthFlowTest {

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	JsonMapper json;

	@Test
	void 가입하면_바로_로그인되고_정규화된_이메일과_기본_프로필을_돌려준다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse response = signup(mvc, "  " + email.toUpperCase() + " ");

		assertThat(response.getStatus()).isEqualTo(201);
		var me = json.readTree(response.getContentAsString());
		assertThat(me.get("email").asString()).isEqualTo(email);
		assertThat(me.get("emailVerified").asBoolean()).isFalse();
		assertThat(me.get("timezone").asString()).isEqualTo("Asia/Seoul");
		assertThat(me.get("weekStart").asString()).isEqualTo("MONDAY");
		assertThat(me.get("workDays").asInt()).isEqualTo(31);
		assertThat(me.get("themeAccent").asString()).isEqualTo("#4B3FD6");
		assertThat(me.get("version").asLong()).isZero();
		assertThat(UUID.fromString(me.get("id").asString()).version()).isEqualTo(7);

		assertThat(setCookie(response, "access_token")).contains("Path=/api;", "Max-Age=600", "Secure", "HttpOnly",
				"SameSite=Strict");
		assertThat(setCookie(response, "refresh_token")).contains("Path=/api/auth;", "Max-Age=1209600", "Secure",
				"HttpOnly", "SameSite=Strict");

		mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + cookieValue(response, "access_token")))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.id").value(me.get("id").asString()));

		String created = jdbc.queryForObject("SELECT type FROM user_events WHERE user_id = ?", String.class,
				UUID.fromString(me.get("id").asString()));
		assertThat(created).isEqualTo("CREATED");
	}

	@Test
	void 이미_가입된_이메일은_대소문자가_달라도_409() throws Exception {
		String email = newEmail();
		signup(mvc, email);
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content(signupJson(email.toUpperCase(), PASSWORD)))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("EMAIL_ALREADY_EXISTS"));
	}

	@Test
	void 비밀번호_규칙을_여러_개_어기면_모두_돌려준다() throws Exception {
		// 한글 25자 = 75바이트, 영문·숫자 없음
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content(signupJson(newEmail(), "가".repeat(25))))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[*].code").value(
					containsInAnyOrder("PASSWORD_TOO_LONG_BYTES", "PASSWORD_LETTER_DIGIT_REQUIRED")))
			.andExpect(jsonPath("$.errors[*].field").value(containsInAnyOrder("password", "password")));
	}

	@Test
	void 이메일과_같은_비밀번호와_짧은_비밀번호를_거부한다() throws Exception {
		String email = "abc12345@example.com";
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content(signupJson(email, email.toUpperCase())))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errors[*].code").value(containsInAnyOrder("PASSWORD_SAME_AS_EMAIL")));
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content(signupJson(newEmail(), "abc123")))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errors[*].code").value(containsInAnyOrder("PASSWORD_LENGTH")));
	}

	@Test
	void 이메일_형식과_필수_동의를_검사한다() throws Exception {
		mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content("""
					{"email":"not-an-email","password":"secret123","agreeTerms":false,"agreePrivacy":true}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errors[*].code").value(containsInAnyOrder("EMAIL_INVALID", "AGREEMENT_REQUIRED")));
	}

	@Test
	void 로그인_성공과_실패() throws Exception {
		String email = newEmail();
		signup(mvc, email);

		MockHttpServletResponse ok = mvc
			.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\" %s \",\"password\":\"%s\"}".formatted(email.toUpperCase(), PASSWORD)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.email").value(email))
			.andReturn()
			.getResponse();
		assertThat(cookieValue(ok, "access_token")).isNotBlank();
		assertThat(cookieValue(ok, "refresh_token")).isNotBlank();

		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.content("{\"email\":\"%s\",\"password\":\"wrong-pass1\"}".formatted(email)))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(newEmail(), PASSWORD)))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
	}

	@Test
	void 갱신하면_두_쿠키를_교체하고_30초_안의_직전_토큰은_access만_준다() throws Exception {
		String first = cookieValue(signup(mvc, newEmail()), "refresh_token");

		MockHttpServletResponse rotated = refresh(mvc, first);
		assertThat(rotated.getStatus()).isEqualTo(204);
		String second = cookieValue(rotated, "refresh_token");
		assertThat(second).isNotBlank().isNotEqualTo(first);
		assertThat(cookieValue(rotated, "access_token")).isNotBlank();

		// 다른 탭이 같은 직전 토큰으로 거의 동시에 갱신
		MockHttpServletResponse grace = refresh(mvc, first);
		assertThat(grace.getStatus()).isEqualTo(204);
		assertThat(cookieValue(grace, "access_token")).isNotBlank();
		assertThat(setCookie(grace, "refresh_token")).isNull();

		// 세션은 그대로 이어진다
		assertThat(refresh(mvc, second).getStatus()).isEqualTo(204);
	}

	@Test
	void 유예가_지난_폐기_토큰이_오면_세션_전체를_폐기한다() throws Exception {
		String first = cookieValue(signup(mvc, newEmail()), "refresh_token");
		String second = cookieValue(refresh(mvc, first), "refresh_token");
		jdbc.update("UPDATE refresh_tokens SET revoked_at = revoked_at - interval '31 seconds' WHERE token_hash = ?",
				RefreshTokenService.hash(first));

		MockHttpServletResponse reuse = refresh(mvc, first);
		assertThat(reuse.getStatus()).isEqualTo(401);
		assertThat(json.readTree(reuse.getContentAsString()).get("code").asString()).isEqualTo("REFRESH_INVALID");
		assertThat(setCookie(reuse, "access_token")).contains("Max-Age=0", "Path=/api;");
		assertThat(setCookie(reuse, "refresh_token")).contains("Max-Age=0", "Path=/api/auth;");

		assertThat(refresh(mvc, second).getStatus()).isEqualTo(401);
	}

	@Test
	void 로그아웃하면_세션을_폐기하고_직전_토큰도_유예하지_않는다() throws Exception {
		String first = cookieValue(signup(mvc, newEmail()), "refresh_token");
		String second = cookieValue(refresh(mvc, first), "refresh_token");

		MockHttpServletResponse logout = mvc.perform(post("/api/auth/logout").cookie(new Cookie("refresh_token", second)))
			.andExpect(status().isNoContent())
			.andReturn()
			.getResponse();
		assertThat(setCookie(logout, "refresh_token")).contains("Max-Age=0");

		assertThat(refresh(mvc, second).getStatus()).isEqualTo(401);
		assertThat(refresh(mvc, first).getStatus()).isEqualTo(401);
	}

	@Test
	void 쿠키_없는_갱신은_401_로그아웃은_204() throws Exception {
		assertThat(refresh(mvc, null).getStatus()).isEqualTo(401);
		mvc.perform(post("/api/auth/logout")).andExpect(status().isNoContent());
	}

	@Test
	void 현재_사용자_조회는_이_서비스가_서명한_사용자_토큰만_받는다() throws Exception {
		mvc.perform(get("/api/users/me"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
		// 다른 키로 서명한 토큰
		mvc.perform(get("/api/users/me").header("Authorization", "Bearer " + TestJwt.userToken(UUID.randomUUID())))
			.andExpect(status().isUnauthorized());
	}

	@Test
	void JWKS는_RS256_공개키만_게시한다() throws Exception {
		mvc.perform(get("/.well-known/jwks.json"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.keys[0].kty").value("RSA"))
			.andExpect(jsonPath("$.keys[0].alg").value("RS256"))
			.andExpect(jsonPath("$.keys[0].use").value("sig"))
			.andExpect(jsonPath("$.keys[0].kid").value("local"))
			.andExpect(jsonPath("$.keys[0].d").doesNotExist());
	}

}

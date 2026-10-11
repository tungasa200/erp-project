package com.erp.identity.verification;

import static com.erp.identity.AuthTestSupport.PASSWORD;
import static com.erp.identity.AuthTestSupport.cookieValue;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.refresh;
import static com.erp.identity.AuthTestSupport.setCookie;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.erp.identity.PostgresTestConfig;
import com.erp.identity.mail.Mailer;
import com.erp.identity.mail.Mailer.Mail;

/** 이메일 인증(P1-12)과 비밀번호 재설정(P1-13). 메일은 커밋 뒤 비동기로 보내므로 timeout으로 기다린다. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class VerificationFlowTest {

	private static final Pattern CODE = Pattern.compile("\\b(\\d{6})\\b");

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@MockitoBean
	Mailer mailer;

	@Test
	void 가입하면_인증번호_메일을_보내고_코드로_인증한다() throws Exception {
		String email = newEmail();
		String token = cookieValue(signup(mvc, email), "access_token");
		Mail mail = lastMail();
		assertThat(mail.to()).isEqualTo(email);
		assertThat(mail.subject()).isEqualTo("[WY Worklog] 이메일 인증번호 안내");
		String code = code(mail);
		assertThat(mail.subject()).doesNotContain(code);
		assertThat(mail.html()).contains(code).contains("이 메일은 발신 전용이에요.");

		mvc.perform(get("/api/users/me/email-verification").header("Authorization", "Bearer " + token))
			.andExpect(jsonPath("$.verified").value(false))
			.andExpect(jsonPath("$.attemptsRemaining").value(5))
			.andExpect(jsonPath("$.expiresAt").isNotEmpty())
			.andExpect(jsonPath("$.resendAvailableAt").isNotEmpty());
		// 60초 안 재발송
		sendCode(token).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("RESEND_TOO_SOON"))
			.andExpect(header().exists("Retry-After"));

		confirmEmail(token, wrong(code)).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("CODE_MISMATCH"))
			.andExpect(jsonPath("$.attemptsRemaining").value(4));
		confirmEmail(token, "12ab").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].code").value("CODE_FORMAT"));
		confirmEmail(token, code).andExpect(status().isOk())
			.andExpect(jsonPath("$.emailVerified").value(true))
			.andExpect(jsonPath("$.version").value(1));
		// 이미 인증됨
		confirmEmail(token, wrong(code)).andExpect(status().isOk());
		sendCode(token).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("EMAIL_ALREADY_VERIFIED"));
		// 인증 완료는 피드에 남기지 않는다
		assertThat(jdbc.queryForObject(
				"SELECT count(*) FROM user_events WHERE user_id = (SELECT id FROM users WHERE email = ?) AND type = 'PROFILE_UPDATED'",
				Integer.class, email)).isZero();
	}

	@Test
	void 다섯번_틀리면_맞는_코드도_만료로_거부하고_새_코드를_받을_수_있다() throws Exception {
		String email = newEmail();
		String token = cookieValue(signup(mvc, email), "access_token");
		String code = code(lastMail());
		for (int i = 4; i >= 0; i--) {
			confirmEmail(token, wrong(code)).andExpect(jsonPath("$.attemptsRemaining").value(i));
		}
		confirmEmail(token, code).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("CODE_EXPIRED"));

		passTime(email, 61);
		sendCode(token).andExpect(status().isAccepted())
			.andExpect(jsonPath("$.expiresAt").isNotEmpty())
			.andExpect(jsonPath("$.resendAvailableAt").isNotEmpty());
		String second = code(lastMail(2));
		confirmEmail(token, second).andExpect(status().isOk());
	}

	@Test
	void 인증_코드는_10분이_지나면_만료된다() throws Exception {
		String email = newEmail();
		String token = cookieValue(signup(mvc, email), "access_token");
		String code = code(lastMail());

		// 9분 59초: 아직 유효하다 (틀리면 시도만 준다)
		age(email, 599);
		confirmEmail(token, wrong(code)).andExpect(jsonPath("$.code").value("CODE_MISMATCH"));
		// 10분 1초: 맞는 코드도 만료
		age(email, 2);
		confirmEmail(token, code).andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("CODE_EXPIRED"));
		mvc.perform(get("/api/users/me/email-verification").header("Authorization", "Bearer " + token))
			.andExpect(jsonPath("$.verified").value(false))
			.andExpect(jsonPath("$.expiresAt").isEmpty())
			.andExpect(jsonPath("$.attemptsRemaining").isEmpty());
	}

	@Test
	void 재설정_코드_재요청은_60초_안이면_거부하고_하루_10통까지() throws Exception {
		String email = newEmail();
		signup(mvc, email);
		lastMail();
		UUID userId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", UUID.class, email);

		// 가입 때 보낸 인증 메일과는 따로 센다
		requestReset(email, newIp()).andExpect(status().isAccepted());
		requestReset(email, newIp()).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("RESEND_TOO_SOON"))
			.andExpect(header().exists("Retry-After"));
		passTime(email, 61);
		requestReset(email, newIp()).andExpect(status().isAccepted());
		lastMail(3);

		// 24시간 안에 10통을 채우면 60초가 지나도 거부
		for (int i = 0; i < 8; i++) {
			jdbc.update("""
					INSERT INTO verification_codes (id, user_id, purpose, code_hash, expires_at, attempts, created_at)
					VALUES (?, ?, 'RESET_PASSWORD', ?, now() - interval '1 hour', 0, now() - interval '2 hours')""",
					UUID.randomUUID(), userId, "0".repeat(64));
		}
		passTime(email, 61);
		requestReset(email, newIp()).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("DAILY_SEND_LIMIT"))
			.andExpect(header().exists("Retry-After"));
		verify(mailer, after(500).times(3)).send(any());
	}

	@Test
	void 로그인이_잠긴_동안_비밀번호를_재설정하면_잠금이_풀린다() throws Exception {
		String email = newEmail();
		signup(mvc, email);
		lastMail();
		// 10번 실패로 잠긴 상태 (잠그는 과정은 LoginProtectionTest)
		jdbc.update("UPDATE users SET failed_login_count = 0, locked_until = now() + interval '15 minutes' WHERE email = ?",
				email);
		login(email, PASSWORD).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("AUTH_LOCKED"));

		requestReset(email, newIp()).andExpect(status().isAccepted());
		confirmReset(email, code(lastMail(2)), "newpass123").andExpect(status().isNoContent());

		assertThat(jdbc.queryForObject("SELECT locked_until IS NULL FROM users WHERE email = ?", Boolean.class, email))
			.isTrue();
		login(email, "newpass123").andExpect(status().isOk());
	}

	@Test
	void 하루_10통을_넘으면_DAILY_SEND_LIMIT() throws Exception {
		String email = newEmail();
		String token = cookieValue(signup(mvc, email), "access_token");
		UUID userId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", UUID.class, email);
		for (int i = 0; i < 9; i++) {
			jdbc.update("""
					INSERT INTO verification_codes (id, user_id, purpose, code_hash, expires_at, attempts, created_at)
					VALUES (?, ?, 'VERIFY_EMAIL', ?, now() - interval '1 hour', 0, now() - interval '2 hours')""",
					UUID.randomUUID(), userId, "0".repeat(64));
		}
		passTime(email, 61);

		sendCode(token).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("DAILY_SEND_LIMIT"));
		mvc.perform(get("/api/users/me/email-verification").header("Authorization", "Bearer " + token))
			.andExpect(jsonPath("$.resendAvailableAt").isNotEmpty());
	}

	@Test
	void 비밀번호를_재설정하면_인증을_완료하고_모든_세션을_끊는다() throws Exception {
		String email = newEmail();
		MockHttpServletResponse signup = signup(mvc, email);
		String oldRefresh = cookieValue(signup, "refresh_token");
		lastMail();
		jdbc.update("UPDATE users SET failed_login_count = 3, locked_until = now() + interval '5 minutes' WHERE email = ?",
				email);

		requestReset(email, newIp()).andExpect(status().isAccepted());
		Mail mail = lastMail(2);
		assertThat(mail.subject()).isEqualTo("[WY Worklog] 비밀번호 재설정 안내");
		assertThat(mail.html()).contains("재설정을 마치면 모든 기기에서 로그아웃돼요.");
		String code = code(mail);

		mvc.perform(json("/api/auth/password-reset/verify", "{\"email\":\"%s\",\"code\":\"%s\"}".formatted(email, wrong(code))))
			.andExpect(jsonPath("$.code").value("CODE_MISMATCH"));
		mvc.perform(json("/api/auth/password-reset/verify", "{\"email\":\"%s\",\"code\":\"%s\"}".formatted(email, code)))
			.andExpect(status().isNoContent());
		// 비밀번호 규칙 오류면 코드는 그대로 남는다
		confirmReset(email, code, "short").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].field").value("newPassword"));

		MockHttpServletResponse done = confirmReset(email, code, "newpass123").andExpect(status().isNoContent())
			.andReturn()
			.getResponse();
		assertThat(setCookie(done, "refresh_token")).contains("Max-Age=0");
		// 같은 코드 재사용 불가, 옛 세션 끊김, 새 비밀번호로 로그인, 인증 완료, 잠금 해제
		confirmReset(email, code, "another123").andExpect(jsonPath("$.code").value("CODE_EXPIRED"));
		assertThat(refresh(mvc, oldRefresh).getStatus()).isEqualTo(401);
		mvc.perform(json("/api/auth/login", "{\"email\":\"%s\",\"password\":\"newpass123\"}".formatted(email))
			.header("X-Client-Ip", newIp()))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.emailVerified").value(true));
		mvc.perform(json("/api/auth/login", "{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, PASSWORD))
			.header("X-Client-Ip", newIp()))
			.andExpect(status().isUnauthorized());
	}

	@Test
	void 없는_이메일도_같은_202이고_메일은_보내지_않는다() throws Exception {
		requestReset(newEmail(), newIp()).andExpect(status().isAccepted())
			.andExpect(jsonPath("$.expiresAt").isNotEmpty())
			.andExpect(jsonPath("$.resendAvailableAt").isNotEmpty());
		verify(mailer, after(500).never()).send(any());
		mvc.perform(json("/api/auth/password-reset/verify", "{\"email\":\"%s\",\"code\":\"123456\"}".formatted(newEmail())))
			.andExpect(jsonPath("$.code").value("CODE_EXPIRED"));
	}

	@Test
	void 한_IP에서_코드_메일_요청은_1시간에_10회까지() throws Exception {
		String ip = newIp();
		for (int i = 0; i < 10; i++) {
			requestReset(newEmail(), ip).andExpect(status().isAccepted());
		}
		requestReset(newEmail(), ip).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("TOO_MANY_REQUESTS"));
		requestReset(newEmail(), newIp()).andExpect(status().isAccepted());
	}

	private Mail lastMail() {
		return lastMail(1);
	}

	/** 이 테스트에서 보낸 n번째 메일까지 기다려 마지막 것을 돌려준다. */
	private Mail lastMail(int count) {
		ArgumentCaptor<Mail> captor = ArgumentCaptor.forClass(Mail.class);
		verify(mailer, timeout(5000).times(count)).send(captor.capture());
		List<Mail> mails = captor.getAllValues();
		return mails.get(mails.size() - 1);
	}

	private static String code(Mail mail) {
		Matcher m = CODE.matcher(mail.text());
		assertThat(m.find()).isTrue();
		return m.group(1);
	}

	private static String wrong(String code) {
		return code.equals("000000") ? "000001" : "000000";
	}

	/** 마지막 발송을 seconds초 앞으로 당겨 60초 재발송 제한을 지난 것으로 만든다. */
	private void passTime(String email, int seconds) {
		jdbc.update("UPDATE verification_codes SET created_at = created_at - make_interval(secs => ?) "
				+ "WHERE user_id = (SELECT id FROM users WHERE email = ?)", seconds, email);
	}

	/** 코드 발급과 만료 시각을 함께 seconds초 앞으로 당겨 그만큼 시간이 지난 것으로 만든다. */
	private void age(String email, int seconds) {
		jdbc.update("UPDATE verification_codes SET created_at = created_at - make_interval(secs => ?), "
				+ "expires_at = expires_at - make_interval(secs => ?) WHERE user_id = (SELECT id FROM users WHERE email = ?)",
				seconds, seconds, email);
	}

	private ResultActions login(String email, String password) throws Exception {
		return mvc.perform(json("/api/auth/login", "{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password))
			.header("X-Client-Ip", newIp()));
	}

	private ResultActions sendCode(String token) throws Exception {
		return mvc.perform(post("/api/users/me/email-verification").header("Authorization", "Bearer " + token)
			.header("X-Client-Ip", newIp()));
	}

	private ResultActions confirmEmail(String token, String code) throws Exception {
		return mvc.perform(json("/api/users/me/email-verification/confirm", "{\"code\":\"%s\"}".formatted(code))
			.header("Authorization", "Bearer " + token));
	}

	private ResultActions requestReset(String email, String ip) throws Exception {
		return mvc.perform(json("/api/auth/password-reset", "{\"email\":\"%s\"}".formatted(email)).header("X-Client-Ip", ip));
	}

	private ResultActions confirmReset(String email, String code, String password) throws Exception {
		return mvc.perform(json("/api/auth/password-reset/confirm",
				"{\"email\":\"%s\",\"code\":\"%s\",\"newPassword\":\"%s\"}".formatted(email, code, password)));
	}

	private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder json(String url,
			String body) {
		return post(url).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	private static String newIp() {
		var random = ThreadLocalRandom.current();
		return "203.0." + random.nextInt(256) + "." + random.nextInt(256);
	}

}

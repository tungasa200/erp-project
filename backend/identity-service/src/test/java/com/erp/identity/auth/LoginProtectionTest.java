package com.erp.identity.auth;

import static com.erp.identity.AuthTestSupport.PASSWORD;
import static com.erp.identity.AuthTestSupport.newEmail;
import static com.erp.identity.AuthTestSupport.signup;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.erp.identity.PostgresTestConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class LoginProtectionTest {

	@Autowired
	MockMvc mvc;

	@Autowired
	JdbcTemplate jdbc;

	@MockitoBean
	LoginProtection.Sleeper sleeper;

	@Test
	void 열번_실패하면_15분_잠기고_잠긴_동안은_맞는_비밀번호도_거부한다() throws Exception {
		String email = newEmail();
		signup(mvc, email);
		long versionBefore = version(email);

		for (int i = 1; i <= 9; i++) {
			login(email, "wrong-pass1").andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
		}
		login(email, "wrong-pass1").andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("AUTH_LOCKED"))
			.andExpect(jsonPath("$.retryAfterSeconds").value(900))
			.andExpect(header().string("Retry-After", "900"));
		// 같은 IP는 이미 IP 제한(10회)에 닿았으므로 다른 IP로 계정 잠금만 확인한다.
		login(email, PASSWORD, newIp()).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("AUTH_LOCKED"));

		// 3번째 실패부터 1·2·4초, 이후 8초로 늦춘다. 잠그는 10번째 실패는 늦추지 않는다.
		ArgumentCaptor<Duration> delays = ArgumentCaptor.forClass(Duration.class);
		verify(sleeper, times(7)).sleep(delays.capture());
		assertThat(delays.getAllValues()).map(Duration::toSeconds).containsExactly(1L, 2L, 4L, 8L, 8L, 8L, 8L);
		// 실패 기록은 users.version을 올리지 않는다 (프로필 PATCH 409 방지).
		assertThat(version(email)).isEqualTo(versionBefore);
	}

	@Test
	void 잠금이_끝나면_로그인되고_실패_횟수를_지운다() throws Exception {
		String email = newEmail();
		signup(mvc, email);
		jdbc.update("UPDATE users SET failed_login_count = 4, locked_until = now() - interval '1 second' WHERE email = ?",
				email);

		login(email, PASSWORD).andExpect(status().isOk());

		assertThat(jdbc.queryForObject("SELECT failed_login_count FROM users WHERE email = ?", Integer.class, email))
			.isZero();
		assertThat(jdbc.queryForObject("SELECT locked_until IS NULL FROM users WHERE email = ?", Boolean.class, email))
			.isTrue();
	}

	@Test
	void 두번째_실패까지는_늦추지_않고_없는_이메일은_기록하지_않는다() throws Exception {
		String email = newEmail();
		signup(mvc, email);

		login(email, "wrong-pass1").andExpect(status().isUnauthorized());
		login(email, "wrong-pass1").andExpect(status().isUnauthorized());
		login(newEmail(), PASSWORD).andExpect(status().isUnauthorized());

		verify(sleeper, never()).sleep(ArgumentMatchers.any());
		assertThat(jdbc.queryForObject("SELECT failed_login_count FROM users WHERE email = ?", Integer.class, email))
			.isEqualTo(2);
	}

	@Test
	void 지연은_8초에서_멈춘다() {
		assertThat(LoginProtection.delayFor(2)).isZero();
		assertThat(LoginProtection.delayFor(3)).isEqualTo(Duration.ofSeconds(1));
		assertThat(LoginProtection.delayFor(6)).isEqualTo(Duration.ofSeconds(8));
		assertThat(LoginProtection.delayFor(50)).isEqualTo(Duration.ofSeconds(8));
	}

	@Test
	void 한_IP에서_분당_10번_실패하면_없는_이메일이어도_429() throws Exception {
		String ip = newIp();
		for (int i = 0; i < 10; i++) {
			login(newEmail(), PASSWORD, ip).andExpect(status().isUnauthorized());
		}
		login(newEmail(), PASSWORD, ip).andExpect(status().isTooManyRequests())
			.andExpect(jsonPath("$.code").value("TOO_MANY_REQUESTS"))
			.andExpect(header().exists("Retry-After"));
		// 다른 IP는 영향 없음
		login(newEmail(), PASSWORD, newIp()).andExpect(status().isUnauthorized());
	}

	@Test
	void 운영에서_접속자_IP_헤더가_없으면_IP_제한을_하지_않는다() {
		var gatewayCall = new MockHttpServletRequest();
		gatewayCall.setRemoteAddr("10.0.0.5");
		assertThat(IpLoginLimiter.clientIp(gatewayCall)).isNull();

		gatewayCall.addHeader("X-Client-Ip", "203.0.113.7");
		assertThat(IpLoginLimiter.clientIp(gatewayCall)).isEqualTo("203.0.113.7");

		var localCall = new MockHttpServletRequest();
		localCall.setRemoteAddr("127.0.0.1");
		assertThat(IpLoginLimiter.clientIp(localCall)).isEqualTo("127.0.0.1");
	}

	/** 테스트마다 IP를 달리해 IP 단위 제한이 다른 테스트에 번지지 않게 한다. */
	private final String ip = newIp();

	private ResultActions login(String email, String password) throws Exception {
		return login(email, password, ip);
	}

	private ResultActions login(String email, String password, String clientIp) throws Exception {
		return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.header("X-Client-Ip", clientIp)
			.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)));
	}

	private static String newIp() {
		var random = ThreadLocalRandom.current();
		return "198.51." + random.nextInt(256) + "." + random.nextInt(256);
	}

	private long version(String email) {
		return jdbc.queryForObject("SELECT version FROM users WHERE email = ?", Long.class, email);
	}

}

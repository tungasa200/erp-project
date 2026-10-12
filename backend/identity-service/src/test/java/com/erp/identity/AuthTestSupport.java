package com.erp.identity;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

import jakarta.servlet.http.Cookie;

import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/** 인증 통합 테스트 공통 도구. 테스트끼리 DB를 공유하므로 이메일은 매번 새로 만든다. */
public final class AuthTestSupport {

	public static final String PASSWORD = "secret123";

	/** 이메일별 마지막으로 보낸 코드 (PostgresTestConfig가 채운다). */
	public static final Map<String, String> SENT_CODES = new ConcurrentHashMap<>();

	private AuthTestSupport() {
	}

	public static String newEmail() {
		return "user-" + UUID.randomUUID() + "@example.com";
	}

	public static String newIp() {
		ThreadLocalRandom r = ThreadLocalRandom.current();
		return "10.%d.%d.%d".formatted(r.nextInt(256), r.nextInt(256), r.nextInt(1, 255));
	}

	public static String signupJson(String email, String password) {
		return """
				{"email":"%s","password":"%s","agreeTerms":true,"agreePrivacy":true}
				""".formatted(email, password);
	}

	/** 가입 신청 → 메일로 보낸 코드로 가입 확인까지 한다(D-220). 가입 확인 응답(201, 쿠키 2종)을 돌려준다. */
	public static MockHttpServletResponse signup(MockMvc mvc, String email) throws Exception {
		MockHttpServletResponse requested = requestSignup(mvc, email, PASSWORD);
		if (requested.getStatus() != 202) {
			throw new AssertionError("가입 신청 실패 " + requested.getStatus() + " " + requested.getContentAsString());
		}
		String normalized = email.strip().toLowerCase(Locale.ROOT);
		return confirmSignup(mvc, normalized, SENT_CODES.get(normalized));
	}

	public static MockHttpServletResponse requestSignup(MockMvc mvc, String email, String password) throws Exception {
		return mvc
			.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
				.header("X-Client-Ip", newIp()) // 가입 신청은 IP 단위 발송 제한(1시간 10회)을 받는다
				.content(signupJson(email, password)))
			.andReturn()
			.getResponse();
	}

	public static MockHttpServletResponse confirmSignup(MockMvc mvc, String email, String code) throws Exception {
		return mvc
			.perform(post("/api/auth/signup/confirm").contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"email":"%s","code":"%s"}
						""".formatted(email, code)))
			.andReturn()
			.getResponse();
	}

	public static MockHttpServletResponse refresh(MockMvc mvc, String refreshToken) throws Exception {
		var request = post("/api/auth/refresh");
		if (refreshToken != null) {
			request.cookie(new Cookie("refresh_token", refreshToken));
		}
		return mvc.perform(request).andReturn().getResponse();
	}

	/** Set-Cookie 헤더 원문 (속성 포함). 없으면 null. */
	public static String setCookie(MockHttpServletResponse response, String name) {
		List<String> headers = response.getHeaders("Set-Cookie");
		return headers.stream().filter(h -> h.startsWith(name + "=")).findFirst().orElse(null);
	}

	/** Set-Cookie 헤더의 값만. 없으면 null. */
	public static String cookieValue(MockHttpServletResponse response, String name) {
		String header = setCookie(response, name);
		return header == null ? null : header.substring(name.length() + 1, header.indexOf(';'));
	}

}

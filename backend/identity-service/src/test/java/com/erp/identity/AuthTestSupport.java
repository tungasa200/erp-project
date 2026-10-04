package com.erp.identity;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/** 인증 통합 테스트 공통 도구. 테스트끼리 DB를 공유하므로 이메일은 매번 새로 만든다. */
public final class AuthTestSupport {

	public static final String PASSWORD = "secret123";

	private AuthTestSupport() {
	}

	public static String newEmail() {
		return "user-" + UUID.randomUUID() + "@example.com";
	}

	public static String signupJson(String email, String password) {
		return """
				{"email":"%s","password":"%s","agreeTerms":true,"agreePrivacy":true}
				""".formatted(email, password);
	}

	public static MockHttpServletResponse signup(MockMvc mvc, String email) throws Exception {
		return mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
			.content(signupJson(email, PASSWORD))).andReturn().getResponse();
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

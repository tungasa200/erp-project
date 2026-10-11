package com.erp.identity.mail;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 메일 발송 (D-57): Gmail SMTP + 앱 비밀번호. 보내는 주소는 Gmail 계정 주소(username) 그대로다.
 * username이 비어 있으면 실제로 보내지 않고 로그에 남긴다(로컬 전용). 운영은 required=true라 비어 있으면 기동하지 않는다.
 * Spring Boot는 풀리지 않은 ${...}를 글자 그대로 넣으므로 여기서 막는다 (JwtProperties와 같다).
 */
@ConfigurationProperties("identity.mail")
public record MailProperties(String username, String password, String fromName, boolean required) {

	public MailProperties {
		if (unresolved(username) || unresolved(password)) {
			throw new IllegalStateException("MAIL_USERNAME·MAIL_PASSWORD 환경 변수가 없습니다.");
		}
		if (required && (blank(username) || blank(password))) {
			throw new IllegalStateException("MAIL_USERNAME·MAIL_PASSWORD 환경 변수가 비어 있습니다.");
		}
		if (blank(fromName) || unresolved(fromName)) {
			fromName = "WY Worklog";
		}
	}

	/** 실제 SMTP로 보낼지. */
	public boolean smtpEnabled() {
		return !blank(username);
	}

	private static boolean unresolved(String value) {
		return value != null && value.contains("${");
	}

	private static boolean blank(String value) {
		return value == null || value.isBlank();
	}

}

package com.erp.identity.mail;

/**
 * 메일 한 통 발송. 실패하면 예외를 던진다(호출하는 쪽이 로그로 남긴다).
 */
public interface Mailer {

	void send(Mail mail);

	/** 텍스트 본문과 HTML 본문을 함께 보낸다(SCR-MAIL 메일 제약: 텍스트 버전 동봉). */
	record Mail(String to, String subject, String text, String html) {
	}

}

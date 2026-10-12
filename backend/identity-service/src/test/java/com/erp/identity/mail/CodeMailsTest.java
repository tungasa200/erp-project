package com.erp.identity.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.erp.identity.mail.Mailer.Mail;
import jakarta.mail.BodyPart;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;

/** 인증·재설정 메일의 미리보기 노출 방지(UX-MAIL-91)와 MIME 구조. 실제 발송은 하지 않는다. */
class CodeMailsTest {

	private static final String CODE = "123456";

	@Test
	void 두_메일_모두_HTML_맨_앞에_숨김_프리헤더와_공백_채움이_있고_코드는_그_뒤에_온다() {
		for (Mail mail : List.of(CodeMails.emailVerification("a@example.com", CODE),
				CodeMails.passwordReset("a@example.com", CODE))) {
			String html = mail.html();
			String body = html.substring(html.indexOf("<body"));
			String firstDiv = body.substring(body.indexOf("<div"), body.indexOf("</div>"));

			assertThat(body.indexOf("<div")).isLessThan(body.indexOf("<table"));
			assertThat(firstDiv).contains("display:none").contains("mso-hide:all")
				.contains(CodeMails.PREHEADER).contains(CodeMails.PREHEADER_FILL).doesNotContain(CODE);
			assertThat(CodeMails.PREHEADER_FILL).isEqualTo("&#847;&zwnj;&nbsp;".repeat(60));
			assertThat(html.indexOf(CODE)).isGreaterThan(html.indexOf("</div>"));
		}
	}

	@Test
	void 텍스트_버전_첫_줄은_코드_없는_안내_문장이다() {
		for (Mail mail : List.of(CodeMails.emailVerification("a@example.com", CODE),
				CodeMails.passwordReset("a@example.com", CODE))) {
			String firstLine = mail.text().lines().findFirst().orElseThrow();
			assertThat(firstLine).isEqualTo(CodeMails.PREHEADER).doesNotContain(CODE);
			assertThat(mail.text()).contains(CODE);
		}
	}

	@Test
	void 보내는_메시지는_text_plain과_text_html을_multipart_alternative로_묶는다() throws Exception {
		MailProperties properties = new MailProperties("sender@example.com", "pw", "WY Worklog", false);
		Mail mail = CodeMails.emailVerification("a@example.com", CODE);
		MimeMessage message = MailConfig.compose(new JavaMailSenderImpl().createMimeMessage(), properties, mail);
		message.saveChanges();

		List<Part> alternatives = new ArrayList<>();
		collectAlternatives(message, alternatives);

		assertThat(alternatives).hasSize(2);
		assertThat(alternatives.get(0).isMimeType("text/plain")).isTrue();
		assertThat(alternatives.get(1).isMimeType("text/html")).isTrue();
		assertThat((String) alternatives.get(0).getContent()).startsWith(CodeMails.PREHEADER);
		assertThat((String) alternatives.get(1).getContent()).contains(CodeMails.PREHEADER);
		assertThat(message.getSubject()).doesNotContain(CODE);
	}

	/** multipart/alternative 바로 아래 부분들을 모은다. */
	private static void collectAlternatives(Part part, List<Part> out) throws Exception {
		if (!part.isMimeType("multipart/*")) {
			return;
		}
		Multipart multipart = (Multipart) part.getContent();
		boolean alternative = part.isMimeType("multipart/alternative");
		for (int i = 0; i < multipart.getCount(); i++) {
			BodyPart child = multipart.getBodyPart(i);
			if (alternative) {
				out.add(child);
			}
			else {
				collectAlternatives(child, out);
			}
		}
	}

}

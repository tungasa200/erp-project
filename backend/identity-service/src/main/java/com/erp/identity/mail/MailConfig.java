package com.erp.identity.mail;

import java.nio.charset.StandardCharsets;

import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * MAIL_USERNAME이 있으면 Gmail SMTP로 보내고, 없으면(로컬) 보내지 않고 로그에 남긴다.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MailProperties.class)
@EnableAsync // 커밋 뒤 메일 발송(CodeMailSender)이 응답을 붙잡지 않게 한다. Boot 기본 작업 실행기를 쓴다.
class MailConfig {

	private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

	@Bean
	Mailer mailer(MailProperties properties, JavaMailSender sender) {
		if (!properties.smtpEnabled()) {
			log.info("MAIL_USERNAME이 없어 메일을 보내지 않고 로그에 남깁니다(로컬 전용).");
			// 로컬에서 코드를 확인할 수 있게 본문을 남긴다. 운영은 required=true라 이 경로로 오지 않는다.
			return mail -> log.info("[로컬 메일] to={} subject={}\n{}", mail.to(), mail.subject(), mail.text());
		}
		return mail -> {
			try {
				MimeMessage message = sender.createMimeMessage();
				MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
				helper.setFrom(new InternetAddress(properties.username(), properties.fromName(),
						StandardCharsets.UTF_8.name()));
				helper.setTo(mail.to());
				helper.setSubject(mail.subject());
				helper.setText(mail.text(), mail.html());
				sender.send(message);
			}
			catch (Exception ex) {
				throw new IllegalStateException("메일 발송 실패", ex);
			}
		};
	}

}

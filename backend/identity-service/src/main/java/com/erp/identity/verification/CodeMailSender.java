package com.erp.identity.verification;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

import com.erp.identity.mail.CodeMails;
import com.erp.identity.mail.Mailer;
import com.erp.identity.verification.VerificationCodes.Purpose;

/**
 * 코드 메일은 트랜잭션이 커밋된 뒤 따로 보낸다 (D-53). 롤백되면 보내지 않고, 발송 실패는 요청 결과를 바꾸지 않는다.
 * 실패 로그에는 코드와 받는 주소를 남기지 않는다.
 */
@Component
public class CodeMailSender {

	private static final Logger log = LoggerFactory.getLogger(CodeMailSender.class);

	private final ApplicationEventPublisher events;

	private final Mailer mailer;

	public CodeMailSender(ApplicationEventPublisher events, Mailer mailer) {
		this.events = events;
		this.mailer = mailer;
	}

	/** 트랜잭션 안에서 부른다. 커밋되면 보낸다. */
	public void sendAfterCommit(UUID userId, String email, Purpose purpose, String code) {
		events.publishEvent(new Requested(userId, email, purpose, code));
	}

	@Async
	@TransactionalEventListener
	public void onCommitted(Requested request) {
		try {
			mailer.send(switch (request.purpose()) {
				case VERIFY_EMAIL -> CodeMails.emailVerification(request.email(), request.code());
				case RESET_PASSWORD -> CodeMails.passwordReset(request.email(), request.code());
			});
		}
		catch (RuntimeException ex) {
			log.warn("코드 메일 발송 실패 userId={} purpose={} error={}", request.userId(), request.purpose(),
					ex.getCause() != null ? ex.getCause().getClass().getName() : ex.getClass().getName());
		}
	}

	public record Requested(UUID userId, String email, Purpose purpose, String code) {

		@Override
		public String toString() {
			return "Requested[userId=" + userId + ", purpose=" + purpose + "]";
		}

	}

}

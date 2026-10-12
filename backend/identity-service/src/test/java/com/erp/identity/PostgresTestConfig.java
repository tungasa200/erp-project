package com.erp.identity;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.testcontainers.postgresql.PostgreSQLContainer;

import com.erp.identity.verification.CodeMailSender;

/** 통합 테스트용 PostgreSQL. 로컬 compose와 같은 18 버전을 쓴다. Docker가 필요하다. */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresTestConfig {

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgres() {
		return new PostgreSQLContainer("postgres:18-alpine");
	}

	/** 코드 메일 발송 요청을 엿들어 테스트가 코드를 알 수 있게 한다(Mailer를 목으로 바꾸지 않은 테스트용). */
	@Bean
	SentCodesListener sentCodesListener() {
		return new SentCodesListener();
	}

	static class SentCodesListener {

		@EventListener
		void on(CodeMailSender.Requested request) {
			AuthTestSupport.SENT_CODES.put(request.email(), request.code());
		}

	}

}

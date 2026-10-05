package com.erp.identity;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** 통합 테스트용 PostgreSQL. 로컬 compose와 같은 18 버전을 쓴다. Docker가 필요하다. */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresTestConfig {

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgres() {
		return new PostgreSQLContainer("postgres:18-alpine");
	}

}

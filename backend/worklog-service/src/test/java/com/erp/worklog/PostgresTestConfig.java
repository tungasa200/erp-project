package com.erp.worklog;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * 통합 테스트용 PostgreSQL. 로컬 compose와 같은 18 버전을 쓴다. Docker가 필요하다.
 * compose는 worklog_app 역할에 search_path=worklog를 걸어 두므로 여기서는 접속 URL로 같은 schema를 지정한다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresTestConfig {

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgres() {
		return new PostgreSQLContainer("postgres:18-alpine").withUrlParam("currentSchema", "worklog");
	}
}

package com.erp.common.autoconfigure;

import javax.sql.DataSource;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 주기 작업(@Scheduled)을 인스턴스 하나에서만 돌린다 (D-31).
 * 각 서비스는 자기 schema에 shedlock 테이블을 Flyway로 만든다.
 */
@AutoConfiguration(afterName = "org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration")
@ConditionalOnBean(DataSource.class)
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT10M")
public class ShedLockAutoConfiguration {

	@Bean
	@ConditionalOnMissingBean
	LockProvider lockProvider(DataSource dataSource) {
		return new JdbcTemplateLockProvider(JdbcTemplateLockProvider.Configuration.builder()
			.withJdbcTemplate(new JdbcTemplate(dataSource))
			.usingDbTime()
			.build());
	}

}

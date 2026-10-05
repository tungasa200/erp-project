package com.erp.common.autoconfigure;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.env.MockEnvironment;

class ProdDatasourceGuardTest {

	final ProdDatasourceGuard guard = new ProdDatasourceGuard();

	@Test
	void prod에서_DB_접속_정보가_비면_기동을_막는다() {
		MockEnvironment env = prod().withProperty("spring.datasource.url", "jdbc:postgresql://db:5432/railway")
			.withProperty("spring.datasource.username", "worklog_app")
			.withProperty("spring.datasource.password", "");

		assertThatThrownBy(() -> guard.postProcessEnvironment(env, null)).isInstanceOf(IllegalStateException.class)
			.hasMessageContaining("spring.datasource.password");
	}

	@Test
	void 풀리지_않은_자리표시자도_빈_값으로_본다() {
		MockEnvironment env = prod().withProperty("spring.datasource.url", "${DB_URL}")
			.withProperty("spring.datasource.username", "worklog_app")
			.withProperty("spring.datasource.password", "secret");

		assertThatThrownBy(() -> guard.postProcessEnvironment(env, null)).hasMessageContaining("spring.datasource.url");
	}

	@Test
	void 값이_다_있거나_prod가_아니면_통과한다() {
		MockEnvironment complete = prod().withProperty("spring.datasource.url", "jdbc:postgresql://db:5432/railway")
			.withProperty("spring.datasource.username", "worklog_app")
			.withProperty("spring.datasource.password", "secret");

		assertThatCode(() -> guard.postProcessEnvironment(complete, null)).doesNotThrowAnyException();
		assertThatCode(() -> guard.postProcessEnvironment(new MockEnvironment(), null)).doesNotThrowAnyException();
	}

	@Test
	void spring_factories로_등록돼_실제_기동에서_막는다() {
		SpringApplication app = new SpringApplication(EmptyConfig.class);
		app.setWebApplicationType(WebApplicationType.NONE);
		app.setAdditionalProfiles("prod");
		app.setDefaultProperties(Map.of("spring.datasource.url", "jdbc:postgresql://db:5432/railway",
				"spring.datasource.username", "worklog_app", "spring.datasource.password", ""));

		assertThatThrownBy(app::run).hasMessageContaining("spring.datasource.password");
	}

	@Configuration(proxyBeanMethods = false)
	static class EmptyConfig {

	}

	private static MockEnvironment prod() {
		MockEnvironment env = new MockEnvironment();
		env.setActiveProfiles("prod");
		return env;
	}

}

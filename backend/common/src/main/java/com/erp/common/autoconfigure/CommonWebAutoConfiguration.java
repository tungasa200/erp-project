package com.erp.common.autoconfigure;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.web.servlet.HandlerExceptionResolver;

import com.erp.common.error.ApiExceptionHandler;
import com.erp.common.error.ProblemSecurityHandler;
import com.erp.common.error.SecurityExceptionHandler;

/**
 * 서비스는 자기 패키지만 스캔하므로 공통 오류 처리는 자동 설정으로 등록한다.
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@Import(ApiExceptionHandler.class)
public class CommonWebAutoConfiguration {

	// Spring Security는 공통 모듈에서 compileOnly라, 서비스 클래스패스에 없으면 이 설정을 아예 읽지 않아야 한다.
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnClass(name = "org.springframework.security.web.AuthenticationEntryPoint")
	@Import(SecurityExceptionHandler.class)
	static class SecurityProblemConfiguration {

		@Bean
		@ConditionalOnMissingBean
		ProblemSecurityHandler problemSecurityHandler(
				@Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver) {
			return new ProblemSecurityHandler(resolver);
		}

	}

}

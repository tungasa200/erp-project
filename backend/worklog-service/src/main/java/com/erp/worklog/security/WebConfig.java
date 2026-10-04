package com.erp.worklog.security;

import com.erp.worklog.user.DeletedUserInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
public class WebConfig implements WebMvcConfigurer {

	private final DeletedUserInterceptor deletedUserInterceptor;

	WebConfig(DeletedUserInterceptor deletedUserInterceptor) {
		this.deletedUserInterceptor = deletedUserInterceptor;
	}

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
		resolvers.add(new CurrentUserArgumentResolver());
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(deletedUserInterceptor).addPathPatterns("/api/worklog/**");
	}
}

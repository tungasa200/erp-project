package com.erp.identity;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

import com.erp.common.error.ProblemSecurityHandler;

@Configuration
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP, scheme = "bearer", bearerFormat = "JWT")
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, ProblemSecurityHandler problems) throws Exception {
		http
			// 쿠키 인증 경로의 CSRF는 SameSite=Strict와 Gateway의 Origin 검사가 막는다 (NFR-02).
			.csrf(csrf -> csrf.disable())
			.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(auth -> auth
				.requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login", "/api/auth/refresh",
						"/api/auth/logout")
				.permitAll()
				// Gateway가 외부로 라우팅하지 않는 경로 (내부 전용)
				.requestMatchers(HttpMethod.GET, "/.well-known/jwks.json", "/v3/api-docs", "/v3/api-docs/**")
				.permitAll()
				.requestMatchers("/actuator/health", "/actuator/health/**")
				.permitAll()
				.requestMatchers("/api/users/me", "/api/users/me/**")
				.authenticated()
				.anyRequest()
				.denyAll())
			.oauth2ResourceServer(rs -> rs.jwt(jwt -> {
			}).authenticationEntryPoint(problems).accessDeniedHandler(problems))
			.exceptionHandling(e -> e.authenticationEntryPoint(problems).accessDeniedHandler(problems));
		return http.build();
	}

	@Bean
	PasswordEncoder passwordEncoder() {
		return new BCryptPasswordEncoder();
	}

}

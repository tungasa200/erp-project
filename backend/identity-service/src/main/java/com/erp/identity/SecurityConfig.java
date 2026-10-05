package com.erp.identity;

import com.nimbusds.jose.jwk.RSAKey;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.web.servlet.HandlerExceptionResolver;

import com.erp.common.error.ApiException;
import com.erp.common.error.ProblemSecurityHandler;
import com.erp.identity.token.JwtKeyConfig;

@Configuration
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP, scheme = "bearer", bearerFormat = "JWT")
@SecurityScheme(name = "serviceToken", type = SecuritySchemeType.HTTP, scheme = "bearer", bearerFormat = "JWT",
		description = "/internal/oauth/token으로 받은 서비스 토큰 (aud=erp-internal, scope 필수)")
public class SecurityConfig {

	public static final String INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE";

	/**
	 * 서비스 간 API (D-29). 서비스 토큰(aud=erp-internal)만 받고 경로마다 scope를 확인한다.
	 * 토큰 발급은 컨트롤러가 HTTP Basic을 직접 확인한다(RFC 6749 오류 형식).
	 */
	@Bean
	@Order(1)
	SecurityFilterChain internalFilterChain(HttpSecurity http, ProblemSecurityHandler problems, RSAKey signingKey,
			@Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver) throws Exception {
		AccessDeniedHandler insufficientScope = (request, response, ex) -> resolver.resolveException(request,
				response, null, new ApiException(HttpStatus.FORBIDDEN, INSUFFICIENT_SCOPE, "필요한 scope가 없습니다."));
		http.securityMatcher("/internal/**")
			.csrf(csrf -> csrf.disable())
			.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(auth -> auth.requestMatchers(HttpMethod.POST, "/internal/oauth/token")
				.permitAll()
				.requestMatchers(HttpMethod.GET, "/internal/user-events")
				.hasAuthority("SCOPE_user-events:read")
				.requestMatchers(HttpMethod.GET, "/internal/users", "/internal/deleted-users")
				.hasAuthority("SCOPE_users:read")
				.anyRequest()
				.denyAll())
			.oauth2ResourceServer(rs -> rs.jwt(jwt -> jwt.decoder(JwtKeyConfig.serviceTokenDecoder(signingKey)))
				.authenticationEntryPoint(problems)
				.accessDeniedHandler(insufficientScope))
			.exceptionHandling(e -> e.authenticationEntryPoint(problems).accessDeniedHandler(insufficientScope));
		return http.build();
	}

	@Bean
	@Order(2)
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

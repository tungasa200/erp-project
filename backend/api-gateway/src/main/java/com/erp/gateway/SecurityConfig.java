package com.erp.gateway;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.context.NoOpServerSecurityContextRepository;

import java.util.List;

@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

	@Bean
	SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
		return http
				.csrf(ServerHttpSecurity.CsrfSpec::disable) // CSRF는 SameSite=Strict + OriginCheckFilter (NFR-14)
				.httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
				.formLogin(ServerHttpSecurity.FormLoginSpec::disable)
				.logout(ServerHttpSecurity.LogoutSpec::disable)
				.securityContextRepository(NoOpServerSecurityContextRepository.getInstance())
				.authorizeExchange(exchanges -> exchanges
						.pathMatchers("/api/users/me", "/api/users/me/**", "/api/worklog/**").authenticated()
						// 나머지는 라우트가 정한다: /api/auth/**는 identity로, 라우트 없는 경로(/internal/** 등)는 404
						.anyExchange().permitAll())
				.oauth2ResourceServer(rs -> rs
						.jwt(Customizer.withDefaults())
						.authenticationEntryPoint((exchange, e) ->
								Problems.write(exchange, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.")))
				.build();
	}

	@Bean
	ReactiveJwtDecoder jwtDecoder(GatewayProperties props) {
		NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withJwkSetUri(props.jwkSetUri()).build();
		decoder.setJwtValidator(userTokenValidator(props));
		return decoder;
	}

	/** 만료·iss 검증에 aud=erp-api 확인을 더한다. 서비스 토큰(aud=erp-internal)은 외부 경로에서 거부된다. */
	static OAuth2TokenValidator<Jwt> userTokenValidator(GatewayProperties props) {
		return new DelegatingOAuth2TokenValidator<>(
				JwtValidators.createDefaultWithIssuer(props.issuer()),
				new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(props.audience())));
	}
}

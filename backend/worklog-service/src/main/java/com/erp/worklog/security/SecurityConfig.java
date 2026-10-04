package com.erp.worklog.security;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import java.util.List;

@Configuration
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
		http
				.csrf(csrf -> csrf.disable()) // 쿠키를 받지 않고 Bearer만 받는다. CSRF는 Gateway의 Origin 검사가 담당 (NFR-02)
				.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(auth -> auth
						.requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
						.requestMatchers("/api/worklog/**").authenticated()
						.anyRequest().denyAll())
				.oauth2ResourceServer(rs -> rs.jwt(jwt -> {}));
		return http.build();
	}

	@Bean
	JwtDecoder jwtDecoder(JwtProperties props) {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(props.jwkSetUri()).build();
		decoder.setJwtValidator(userTokenValidator(props));
		return decoder;
	}

	/** 만료·iss 검증에 aud=erp-api 확인을 더한다. 서비스 토큰(aud=erp-internal)은 여기서 거부된다. */
	static OAuth2TokenValidator<Jwt> userTokenValidator(JwtProperties props) {
		return new DelegatingOAuth2TokenValidator<>(
				JwtValidators.createDefaultWithIssuer(props.issuer()),
				new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(props.audience())));
	}
}

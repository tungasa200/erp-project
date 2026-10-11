package com.erp.worklog.security;

import com.erp.common.error.ProblemSecurityHandler;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeIn;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cache.concurrent.ConcurrentMapCache;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
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
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.List;

@Configuration
@EnableConfigurationProperties(JwtProperties.class)
// 브라우저는 access_token 쿠키만 보낸다. Gateway가 Bearer로 옮겨 전달한다 (contracts/worklog.yaml)
@SecurityScheme(name = SecurityConfig.COOKIE_SCHEME, type = SecuritySchemeType.APIKEY, in = SecuritySchemeIn.COOKIE,
		paramName = "access_token")
public class SecurityConfig {

	public static final String COOKIE_SCHEME = "accessTokenCookie";
	static final Duration JWKS_CONNECT_TIMEOUT = Duration.ofSeconds(2);
	static final Duration JWKS_READ_TIMEOUT = Duration.ofSeconds(3);

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, ProblemSecurityHandler problems) throws Exception {
		http
				.csrf(csrf -> csrf.disable()) // 쿠키를 받지 않고 Bearer만 받는다. CSRF는 Gateway의 Origin 검사가 담당 (NFR-02)
				.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(auth -> auth
						.requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
						.requestMatchers("/api/worklog/**").authenticated()
						.anyRequest().denyAll())
				// 토큰 없음·검증 실패(401)와 거부 경로(403)도 Problem 형식으로 응답한다 (P0-10)
				.oauth2ResourceServer(rs -> rs.jwt(jwt -> {}).authenticationEntryPoint(problems).accessDeniedHandler(problems))
				.exceptionHandling(e -> e.authenticationEntryPoint(problems).accessDeniedHandler(problems));
		return http.build();
	}

	@Bean
	JwtDecoder jwtDecoder(JwtProperties props) {
		// identity가 재기동 중이면 키 받기가 기본 30초씩 매달려 그동안 요청이 500으로 실패한다(REL-05). 짧게 끊고 다음 요청에서 다시 받는다.
		SimpleClientHttpRequestFactory http = new SimpleClientHttpRequestFactory();
		http.setConnectTimeout(JWKS_CONNECT_TIMEOUT);
		http.setReadTimeout(JWKS_READ_TIMEOUT);
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(props.jwkSetUri())
				.restOperations(new RestTemplate(http))
				// 키는 한 번 받으면 계속 쓰고, 모르는 kid의 토큰이 올 때만 다시 받는다(사용자 결정 카드 20261011-1930).
				// 기본 5분 주기 갱신이 identity 재배포와 겹쳐 실패하는 일을 없앤다. Gateway 디코더도 같은 방식이다.
				// 키가 유출돼 교체하면 옛 키를 버리도록 worklog·gateway를 재시작해야 한다.
				.cache(new ConcurrentMapCache("jwks"))
				.build();
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

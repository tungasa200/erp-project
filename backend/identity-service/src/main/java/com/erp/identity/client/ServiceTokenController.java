package com.erp.identity.client;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.nimbusds.jose.jwk.RSAKey;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.erp.common.security.JwtClaimNames;

/**
 * 서비스 토큰 발급 (OAuth2 client credentials, D-29). 오류는 Problem이 아니라 RFC 6749 5.2 형식이다.
 * 클라이언트 인증은 HTTP Basic(client_id:secret)이며 Spring Security 대신 여기서 직접 확인한다.
 */
@Tag(name = "internal", description = "서비스 간 API (client credentials 서비스 토큰, D-28·D-29)")
@RestController
public class ServiceTokenController {

	public static final Duration TTL = Duration.ofMinutes(5);

	private final JdbcTemplate jdbc;

	private final PasswordEncoder passwordEncoder;

	private final JwtEncoder encoder;

	private final String keyId;

	private final Clock clock;

	/** 없는 client_id도 BCrypt 비교를 한 번 해서 응답 시간으로 존재 여부를 알 수 없게 한다. */
	private final String dummyHash;

	public ServiceTokenController(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, JwtEncoder encoder,
			RSAKey signingKey, Clock clock) {
		this.jdbc = jdbc;
		this.passwordEncoder = passwordEncoder;
		this.encoder = encoder;
		this.keyId = signingKey.getKeyID();
		this.clock = clock;
		this.dummyHash = passwordEncoder.encode("timing-equalizer-0");
	}

	@Operation(operationId = "issueServiceToken", summary = "서비스 토큰 발급 (OAuth2 client credentials)")
	@ApiResponse(responseCode = "200", description = "발급 성공 (RFC 6749 5.1 형식이라 snake_case)")
	@ApiResponse(responseCode = "400", description = "error=unsupported_grant_type 또는 invalid_scope (RFC 6749 5.2)")
	@ApiResponse(responseCode = "401", description = "error=invalid_client (RFC 6749 5.2)")
	@PostMapping(path = "/internal/oauth/token", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
	public ResponseEntity<Map<String, Object>> token(
			@Parameter(hidden = true) @RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization,
			@RequestParam(name = "grant_type", required = false) String grantType,
			@RequestParam(required = false) String scope) {
		String[] credentials = basicCredentials(authorization);
		List<Map<String, Object>> rows = credentials == null ? List.of()
				: jdbc.queryForList("SELECT secret_hash, scopes FROM service_clients WHERE client_id = ?",
						credentials[0]);
		String hash = rows.isEmpty() ? dummyHash : (String) rows.get(0).get("secret_hash");
		boolean matches = credentials != null && passwordEncoder.matches(credentials[1], hash);
		if (rows.isEmpty() || !matches) {
			return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
				.header(HttpHeaders.WWW_AUTHENTICATE, "Basic realm=\"erp-identity\"")
				.cacheControl(CacheControl.noStore())
				.body(Map.of("error", "invalid_client"));
		}
		if (!"client_credentials".equals(grantType)) {
			return error("unsupported_grant_type");
		}
		Set<String> allowed = split((String) rows.get(0).get("scopes"));
		Set<String> granted = scope == null || scope.isBlank() ? allowed : split(scope);
		if (!allowed.containsAll(granted)) {
			return error("invalid_scope");
		}

		String grantedScope = String.join(" ", granted);
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("access_token", issue(credentials[0], grantedScope));
		body.put("token_type", "Bearer");
		body.put("expires_in", TTL.toSeconds());
		body.put("scope", grantedScope);
		return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
	}

	private String issue(String clientId, String scope) {
		Instant now = clock.instant();
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.issuer(JwtClaimNames.ISSUER)
			.audience(List.of(JwtClaimNames.AUDIENCE_INTERNAL))
			.subject(JwtClaimNames.SERVICE_SUBJECT_PREFIX + clientId)
			.claim(JwtClaimNames.SCOPE, scope)
			.issuedAt(now)
			.expiresAt(now.plus(TTL))
			.build();
		JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
		return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
	}

	private static ResponseEntity<Map<String, Object>> error(String code) {
		return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error", code));
	}

	/** "Basic base64(id:secret)" → [id, secret]. 형식이 틀리면 null. */
	private static String[] basicCredentials(String authorization) {
		if (authorization == null || !authorization.regionMatches(true, 0, "Basic ", 0, 6)) {
			return null;
		}
		try {
			String decoded = new String(Base64.getDecoder().decode(authorization.substring(6).trim()),
					StandardCharsets.UTF_8);
			int colon = decoded.indexOf(':');
			return colon <= 0 ? null : new String[] { decoded.substring(0, colon), decoded.substring(colon + 1) };
		}
		catch (IllegalArgumentException ex) {
			return null;
		}
	}

	private static Set<String> split(String scopes) {
		return new LinkedHashSet<>(Arrays.asList(scopes.trim().split("\\s+")));
	}

}

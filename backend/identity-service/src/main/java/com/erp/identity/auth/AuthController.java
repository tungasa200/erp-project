package com.erp.identity.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.erp.common.error.Problems;
import com.erp.identity.token.AccessTokenIssuer;
import com.erp.identity.user.Me;

/**
 * /api/auth/** — Gateway가 토큰을 검증하지 않고 쿠키를 그대로 넘긴다 (D-46).
 * CSRF는 SameSite=Strict 쿠키와 Gateway의 Origin 검사가 막는다 (NFR-02).
 */
@Tag(name = "auth", description = "가입·로그인·토큰 갱신·로그아웃 (AUTH-01, AUTH-02, AUTH-09)")
@RestController
@RequestMapping("/api/auth")
public class AuthController {

	public static final String REFRESH_INVALID = "REFRESH_INVALID";

	private final AuthService auth;

	private final RefreshTokenService refreshTokens;

	private final AccessTokenIssuer accessTokens;

	public AuthController(AuthService auth, RefreshTokenService refreshTokens, AccessTokenIssuer accessTokens) {
		this.auth = auth;
		this.refreshTokens = refreshTokens;
		this.accessTokens = accessTokens;
	}

	@Operation(operationId = "signup", summary = "회원 가입 후 바로 로그인")
	@ApiResponse(responseCode = "201", description = "가입·로그인 성공. 쿠키 2종 발급")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED (errors[].code는 contracts/identity.yaml)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "409", description = "EMAIL_ALREADY_EXISTS", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@PostMapping("/signup")
	public ResponseEntity<Me> signup(@Valid @RequestBody SignupRequest request) {
		AuthService.Session session = auth.signUp(request);
		return ResponseEntity.status(HttpStatus.CREATED)
			.headers(sessionCookies(session))
			.body(Me.of(session.user()));
	}

	@Operation(operationId = "login", summary = "이메일·비밀번호 로그인")
	@ApiResponse(responseCode = "200", description = "로그인 성공. 쿠키 2종 발급")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "INVALID_CREDENTIALS", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "계정 잠금(AUTH_LOCKED) 또는 IP 단위 시도 제한(TOO_MANY_REQUESTS). 남은 시간은 Retry-After(초)와 retryAfterSeconds", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = AuthOpenApi.RATE_LIMITED_PROBLEM_REF)))
	@PostMapping("/login")
	public ResponseEntity<Me> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
		AuthService.Session session = auth.login(request, IpLoginLimiter.clientIp(httpRequest));
		return ResponseEntity.ok().headers(sessionCookies(session)).body(Me.of(session.user()));
	}

	@Operation(operationId = "refresh", summary = "Access Token 갱신 (Refresh Token rotation)")
	@ApiResponse(responseCode = "204", description = "access_token은 항상, refresh_token은 정상 rotation일 때만 Set-Cookie (30초 유예면 없음)")
	@ApiResponse(responseCode = "401", description = "REFRESH_INVALID. 쿠키 2종을 지운다", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@PostMapping("/refresh")
	public ResponseEntity<?> refresh(@CookieValue(name = AuthCookies.REFRESH, required = false) String refreshToken) {
		if (refreshTokens.refresh(refreshToken) instanceof RefreshTokenService.Outcome.Refreshed refreshed) {
			HttpHeaders headers = new HttpHeaders();
			AuthCookies.setAccess(headers, accessTokens.issue(refreshed.userId()));
			if (refreshed.refreshToken() != null) {
				AuthCookies.setRefresh(headers, refreshed.refreshToken());
			}
			return ResponseEntity.noContent().headers(headers).build();
		}
		ProblemDetail problem = Problems.of(HttpStatus.UNAUTHORIZED, REFRESH_INVALID, "다시 로그인해 주세요.");
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED).headers(AuthCookies.clear()).body(problem);
	}

	@Operation(operationId = "logout", summary = "로그아웃")
	@ApiResponse(responseCode = "204", description = "세션 폐기, 쿠키 2종 삭제. 쿠키가 없거나 이미 폐기돼도 204")
	@PostMapping("/logout")
	public ResponseEntity<Void> logout(
			@CookieValue(name = AuthCookies.REFRESH, required = false) String refreshToken) {
		refreshTokens.endSession(refreshToken);
		return ResponseEntity.noContent().headers(AuthCookies.clear()).build();
	}

	private HttpHeaders sessionCookies(AuthService.Session session) {
		HttpHeaders headers = new HttpHeaders();
		AuthCookies.setAccess(headers, accessTokens.issue(session.user().getId()));
		AuthCookies.setRefresh(headers, session.refreshToken());
		return headers;
	}

}

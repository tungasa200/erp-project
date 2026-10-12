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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.erp.common.error.Problems;
import com.erp.identity.token.AccessTokenIssuer;
import com.erp.identity.user.Me;
import com.erp.identity.verification.VerificationCodes.Issued;
import com.erp.identity.verification.VerificationDtos.CodeCheckRequest;
import com.erp.identity.verification.VerificationDtos.CodeIssued;

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

	@Operation(operationId = "signup", summary = "가입 신청 — 인증 코드 메일 발송 (1단계)",
			description = "계정·쿠키를 만들지 않는다(D-220). 가입 대기를 저장(같은 이메일이면 덮어씀)하고 코드를 커밋 뒤 메일로 보낸다. 코드 다시 받기는 같은 본문으로 다시 보낸다.")
	@ApiResponse(responseCode = "202", description = "가입 대기 저장, 코드 메일 발송 예약")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED (errors[].code는 contracts/identity.yaml)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "409", description = "EMAIL_ALREADY_EXISTS", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "RESEND_TOO_SOON(60초) · DAILY_SEND_LIMIT(24시간 10통) · TOO_MANY_REQUESTS(IP 1시간 10회)", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = AuthOpenApi.RATE_LIMITED_PROBLEM_REF)))
	@PostMapping("/signup")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public CodeIssued signup(@Valid @RequestBody SignupRequest request, HttpServletRequest httpRequest) {
		Issued issued = auth.signUp(request, IpLoginLimiter.clientIp(httpRequest));
		return new CodeIssued(issued.expiresAt(), issued.resendAvailableAt());
	}

	@Operation(operationId = "confirmSignup", summary = "가입 인증 코드 확인 — 계정 생성 후 바로 로그인 (2단계)",
			description = "코드가 맞으면 이메일 인증 완료 상태로 계정을 만들고 쿠키 2종을 발급한다. 가입 대기가 없으면 CODE_EXPIRED.")
	@ApiResponse(responseCode = "201", description = "계정 생성·로그인 성공. 쿠키 2종 발급")
	@ApiResponse(responseCode = "400", description = "CODE_MISMATCH(attemptsRemaining) · CODE_EXPIRED · VALIDATION_FAILED(CODE_FORMAT)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/CodeRejectedProblem")))
	@ApiResponse(responseCode = "409", description = "EMAIL_ALREADY_EXISTS", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@PostMapping("/signup/confirm")
	public ResponseEntity<Me> confirmSignup(@Valid @RequestBody CodeCheckRequest request) {
		AuthService.Session session = auth.confirmSignUp(request.email(), request.code());
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

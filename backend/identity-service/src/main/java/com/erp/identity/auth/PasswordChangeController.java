package com.erp.identity.auth;

import java.util.UUID;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * /api/auth/password-change (AUTH-07, P4-08, SCR-SET-06). /api/auth 아래에 두어 refresh_token 쿠키(Path=/api/auth)로
 * 현재 기기를 가려낸다. Gateway는 /api/auth/**에 Bearer를 붙이지 않으므로 access_token 쿠키를 여기서 직접 검증한다.
 * CSRF는 SameSite=Strict 쿠키와 Gateway의 Origin 검사가 막는다 (NFR-02).
 */
@Tag(name = "auth")
@RestController
public class PasswordChangeController {

	public static final String PATH = "/api/auth/password-change";

	private final PasswordChangeService passwords;

	public PasswordChangeController(PasswordChangeService passwords) {
		this.passwords = passwords;
	}

	public record PasswordChangeRequest(@NotBlank(message = "REQUIRED") String currentPassword,
			@NotBlank(message = "REQUIRED") @Schema(
					description = "8~64자, UTF-8 72바이트 이하, 영문·숫자 포함, 이메일과 다른 문자열 (D-38), 현재 비밀번호와 다른 문자열. errors[].field는 newPassword") String newPassword) {
	}

	@Schema(requiredProperties = { "currentSessionKept" })
	public record PasswordChanged(@Schema(
			description = "true: 현재 기기는 로그인 유지, 다른 기기의 로그인 세션은 폐기. false: 현재 기기를 가려낼 수 없어 모든 로그인 세션을 폐기하고 쿠키를 지움") boolean currentSessionKept) {
	}

	@Operation(operationId = "changePassword", summary = "비밀번호 변경 (AUTH-07, P4-08, SCR-SET-06)",
			description = "현재 비밀번호 확인 뒤 새 비밀번호(D-38)로 바꾼다. 현재 기기의 세션만 남기고 다른 기기의 로그인 세션을 폐기한다.",
			security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "200", description = "변경 완료. currentSessionKept=false이면 쿠키 2종을 지운다")
	@ApiResponse(responseCode = "400", description = "CURRENT_PASSWORD_MISMATCH(errors[].field=currentPassword) 또는 VALIDATION_FAILED(REQUIRED, 비밀번호 규칙, PASSWORD_SAME_AS_CURRENT)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "UNAUTHENTICATED 또는 USER_DELETED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "PASSWORD_CHANGE_LOCKED: 비밀번호 재확인 불일치(회원 탈퇴와 합산) 15분 안에 5회 → 15분 동안 비밀번호 변경·탈퇴를 막음. 남은 시간은 Retry-After(초)와 retryAfterSeconds", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = AuthOpenApi.RATE_LIMITED_PROBLEM_REF)))
	@PostMapping(PATH)
	public ResponseEntity<PasswordChanged> change(@AuthenticationPrincipal Jwt jwt,
			@CookieValue(name = AuthCookies.REFRESH, required = false) String refreshToken,
			@Valid @RequestBody PasswordChangeRequest body) {
		boolean kept = passwords.change(UUID.fromString(jwt.getSubject()), refreshToken, body.currentPassword(),
				body.newPassword());
		ResponseEntity.BodyBuilder response = ResponseEntity.ok();
		if (!kept) {
			response.headers(AuthCookies.clear());
		}
		return response.body(new PasswordChanged(kept));
	}

	/**
	 * Authorization 헤더가 우선이고, 없으면 이 경로에서만 access_token 쿠키를 쓴다.
	 * 다른 /api/auth 경로는 토큰을 보지 않으므로 쿠키를 읽지 않는다.
	 */
	public static BearerTokenResolver bearerTokenResolver() {
		DefaultBearerTokenResolver header = new DefaultBearerTokenResolver();
		return request -> {
			String token = header.resolve(request);
			if (token != null || !PATH.equals(request.getRequestURI())) {
				return token;
			}
			return accessCookie(request);
		};
	}

	private static String accessCookie(HttpServletRequest request) {
		Cookie[] cookies = request.getCookies();
		if (cookies == null) {
			return null;
		}
		for (Cookie cookie : cookies) {
			if (AuthCookies.ACCESS.equals(cookie.getName()) && !cookie.getValue().isBlank()) {
				return cookie.getValue();
			}
		}
		return null;
	}

}

package com.erp.identity.auth;

import java.util.UUID;

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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * /api/users/me/deletion (AUTH-06, P4-05, SCR-SET-07). Gateway가 access_token 쿠키를 Bearer로 옮겨 준다 (D-19).
 * 쿠키를 지우는 응답이 필요해 AuthCookies가 있는 이 패키지에 둔다.
 */
@Tag(name = "me")
@RestController
public class AccountDeletionController {

	private final AccountDeletionService accounts;

	public AccountDeletionController(AccountDeletionService accounts) {
		this.accounts = accounts;
	}

	public record AccountDeletionRequest(
			@NotBlank(message = "REQUIRED") @Schema(description = "현재 비밀번호. errors[].field는 password") String password) {
	}

	@Operation(operationId = "deleteMe", summary = "회원 탈퇴 (AUTH-06, P4-05, SCR-SET-07)",
			description = "비밀번호를 다시 확인한 뒤 즉시 실제로 삭제한다(D-49). 모든 기기의 로그인 세션도 함께 지운다. 다른 모듈은 사용자 변경 피드로 보통 1분, 늦어도 20분 안에 파기한다.",
			security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "204", description = "탈퇴 완료. 쿠키 2종을 지운다")
	@ApiResponse(responseCode = "400", description = "PASSWORD_MISMATCH(errors[].field=password) 또는 VALIDATION_FAILED(REQUIRED)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "UNAUTHENTICATED 또는 USER_DELETED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "PASSWORD_CHANGE_LOCKED: 비밀번호 재확인 불일치(비밀번호 변경과 합산) 15분 안에 5회 → 15분 동안 막음. 남은 시간은 Retry-After(초)와 retryAfterSeconds", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = AuthOpenApi.RATE_LIMITED_PROBLEM_REF)))
	@PostMapping("/api/users/me/deletion")
	public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AccountDeletionRequest body) {
		accounts.delete(UUID.fromString(jwt.getSubject()), body.password());
		return ResponseEntity.noContent().headers(AuthCookies.clear()).build();
	}

}

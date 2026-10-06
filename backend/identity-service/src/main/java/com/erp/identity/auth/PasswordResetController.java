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
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.erp.identity.verification.VerificationDtos.CodeCheckRequest;
import com.erp.identity.verification.VerificationDtos.CodeIssued;
import com.erp.identity.verification.VerificationDtos.PasswordResetConfirmRequest;
import com.erp.identity.verification.VerificationDtos.PasswordResetRequest;

/**
 * /api/auth/password-reset (AUTH-03, P1-13). 로그인하지 않은 상태에서 쓴다.
 */
@Tag(name = "auth")
@RestController
@RequestMapping("/api/auth/password-reset")
public class PasswordResetController {

	private static final String CODE_REJECTED_REF = "#/components/schemas/CodeRejectedProblem";

	private final PasswordResetService resets;

	public PasswordResetController(PasswordResetService resets) {
		this.resets = resets;
	}

	@Operation(operationId = "requestPasswordReset", summary = "비밀번호 재설정 코드 메일 요청 (AUTH-03, P1-13, SCR-AUTH-04)",
			description = "가입 여부와 관계없이 같은 202. 가입된 이메일이면 새 코드를 커밋 뒤 메일로 보낸다(이전 코드 무효).")
	@ApiResponse(responseCode = "202", description = "접수 (가입 여부 비노출)")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "RESEND_TOO_SOON(60초) · DAILY_SEND_LIMIT(24시간 10통) · TOO_MANY_REQUESTS(IP 1시간 10회)", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = AuthOpenApi.RATE_LIMITED_PROBLEM_REF)))
	@PostMapping
	@ResponseStatus(HttpStatus.ACCEPTED)
	public CodeIssued request(@Valid @RequestBody PasswordResetRequest body, HttpServletRequest request) {
		var issued = resets.request(body.email(), IpLoginLimiter.clientIp(request));
		return new CodeIssued(issued.expiresAt(), issued.resendAvailableAt());
	}

	@Operation(operationId = "verifyPasswordResetCode", summary = "재설정 코드 확인 (새 비밀번호 입력 단계로 넘어가기 전)",
			description = "코드가 맞는지만 확인하고 쓰지 않는다. 틀리면 시도 횟수가 준다(5회).")
	@ApiResponse(responseCode = "204", description = "코드가 맞음")
	@ApiResponse(responseCode = "400", description = "CODE_MISMATCH(attemptsRemaining) · CODE_EXPIRED · VALIDATION_FAILED(CODE_FORMAT)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = CODE_REJECTED_REF)))
	@PostMapping("/verify")
	public ResponseEntity<Void> verify(@Valid @RequestBody CodeCheckRequest body) {
		resets.verify(body.email(), body.code());
		return ResponseEntity.noContent().build();
	}

	@Operation(operationId = "confirmPasswordReset", summary = "코드로 새 비밀번호 저장",
			description = "저장하면 이메일 인증 완료, 모든 로그인 세션 폐기와 쿠키 삭제, 로그인 잠금 해제, 코드 사용 처리.")
	@ApiResponse(responseCode = "204", description = "저장 완료. 쿠키 2종을 지운다")
	@ApiResponse(responseCode = "400", description = "코드 오류(CODE_MISMATCH·CODE_EXPIRED) 또는 VALIDATION_FAILED(비밀번호 규칙, errors[].field=newPassword)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = CODE_REJECTED_REF)))
	@PostMapping("/confirm")
	public ResponseEntity<Void> confirm(@Valid @RequestBody PasswordResetConfirmRequest body) {
		resets.confirm(body.email(), body.code(), body.newPassword());
		return ResponseEntity.noContent().headers(AuthCookies.clear()).build();
	}

}

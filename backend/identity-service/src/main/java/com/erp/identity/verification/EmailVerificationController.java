package com.erp.identity.verification;

import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.erp.identity.auth.IpLoginLimiter;
import com.erp.identity.user.Me;
import com.erp.identity.user.ProfileService;
import com.erp.identity.verification.VerificationDtos.CodeIssued;
import com.erp.identity.verification.VerificationDtos.CodeRequest;
import com.erp.identity.verification.VerificationDtos.EmailVerificationStatus;

/**
 * /api/users/me/email-verification (AUTH-08, P1-12). Gateway가 쿠키를 Bearer로 옮겨 주고 여기서 다시 검증한다.
 */
@Tag(name = "me")
@RestController
@RequestMapping("/api/users/me/email-verification")
public class EmailVerificationController {

	private final EmailVerificationService verification;

	private final ProfileService profiles;

	public EmailVerificationController(EmailVerificationService verification, ProfileService profiles) {
		this.verification = verification;
		this.profiles = profiles;
	}

	@Operation(operationId = "getEmailVerification", summary = "이메일 인증 진행 상태 (SCR-AUTH-08 모달을 열 때)",
			security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@GetMapping
	public EmailVerificationStatus status(@AuthenticationPrincipal Jwt jwt) {
		return EmailVerificationStatus.of(verification.status(userId(jwt)));
	}

	@Operation(operationId = "sendEmailVerificationCode", summary = "인증번호 메일 발송·재발송 (AUTH-08, P1-12)",
			description = "새 코드를 발급하고 커밋 뒤 메일로 보낸다. 이전 코드는 무효. 가입 직후 첫 코드는 서버가 자동으로 보낸다.",
			security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "202", description = "새 코드 발급, 메일 발송 예약")
	@ApiResponse(responseCode = "409", description = "EMAIL_ALREADY_VERIFIED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "429", description = "RESEND_TOO_SOON(60초) · DAILY_SEND_LIMIT(24시간 10통) · TOO_MANY_REQUESTS(IP 1시간 10회)", headers = @Header(name = HttpHeaders.RETRY_AFTER, schema = @Schema(type = "integer")), content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/RateLimitedProblem")))
	@PostMapping
	@ResponseStatus(HttpStatus.ACCEPTED)
	public CodeIssued send(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
		return CodeIssued.of(verification.send(userId(jwt), IpLoginLimiter.clientIp(request)));
	}

	@Operation(operationId = "confirmEmailVerification", summary = "인증 코드 확인",
			description = "맞으면 인증을 완료하고 현재 사용자를 준다. 이미 인증된 사용자는 코드와 관계없이 200.",
			security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "200", description = "인증 완료")
	@ApiResponse(responseCode = "400", description = "CODE_MISMATCH(attemptsRemaining) · CODE_EXPIRED · VALIDATION_FAILED(CODE_FORMAT)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/CodeRejectedProblem")))
	@PostMapping("/confirm")
	public Me confirm(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CodeRequest body) {
		UUID userId = userId(jwt);
		verification.confirm(userId, body.code());
		return profiles.get(userId);
	}

	private static UUID userId(Jwt jwt) {
		return UUID.fromString(jwt.getSubject());
	}

}

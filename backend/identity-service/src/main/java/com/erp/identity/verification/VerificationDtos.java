package com.erp.identity.verification;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 이메일 인증·비밀번호 재설정 요청·응답 형태 (contracts/identity.yaml). 검증 message에 errors[].code를 쓴다.
 */
public final class VerificationDtos {

	static final String CODE_PATTERN = "^[0-9]{6}$";

	private VerificationDtos() {
	}

	@Schema(name = "CodeIssued", description = "코드를 새로 발급했을 때 화면의 카운트다운용 시각 (UTC)")
	public record CodeIssued(@Schema(description = "코드 만료 시각 (발급 + 10분)") Instant expiresAt,
			@Schema(description = "다시 받기를 누를 수 있는 시각 (발급 + 60초)") Instant resendAvailableAt) {

		static CodeIssued of(VerificationCodes.Issued issued) {
			return new CodeIssued(issued.expiresAt(), issued.resendAvailableAt());
		}

	}

	@Schema(name = "EmailVerificationStatus", requiredProperties = { "verified" })
	public record EmailVerificationStatus(boolean verified,
			@Schema(types = { "string", "null" }, format = "date-time",
					description = "유효한 코드의 만료 시각. 유효한 코드가 없으면 null") Instant expiresAt,
			@Schema(types = { "integer", "null" },
					description = "유효한 코드의 남은 시도 횟수. 유효한 코드가 없으면 null") Integer attemptsRemaining,
			@Schema(types = { "string", "null" }, format = "date-time",
					description = "다시 받을 수 있는 시각. 지금 받을 수 있으면 null. 하루 한도에 닿았으면 한도가 풀리는 시각") Instant resendAvailableAt) {

		static EmailVerificationStatus of(EmailVerificationService.VerificationStatus status) {
			if (status.verified()) {
				return new EmailVerificationStatus(true, null, null, null);
			}
			var code = status.code();
			return new EmailVerificationStatus(false, code.expiresAt(), code.attemptsRemaining(),
					code.resendAvailableAt());
		}

	}

	@Schema(name = "EmailVerificationConfirmRequest")
	public record CodeRequest(@NotBlank(message = "REQUIRED") @Pattern(regexp = CODE_PATTERN,
			message = "CODE_FORMAT") @Schema(description = "메일로 받은 6자리 숫자") String code) {
	}

	@Schema(name = "PasswordResetRequest")
	public record PasswordResetRequest(@NotBlank(message = "REQUIRED") @Schema(
			description = "가입과 같이 앞뒤 공백 제거·소문자로 비교한다") String email) {
	}

	@Schema(name = "CodeCheckRequest")
	public record CodeCheckRequest(@NotBlank(message = "REQUIRED") String email,
			@NotBlank(message = "REQUIRED") @Pattern(regexp = CODE_PATTERN, message = "CODE_FORMAT") String code) {
	}

	@Schema(name = "PasswordResetConfirmRequest")
	public record PasswordResetConfirmRequest(@NotBlank(message = "REQUIRED") String email,
			@NotBlank(message = "REQUIRED") @Pattern(regexp = CODE_PATTERN, message = "CODE_FORMAT") String code,
			@NotBlank(message = "REQUIRED") @Schema(
					description = "8~64자, UTF-8 72바이트 이하, 영문·숫자 포함, 이메일과 다른 문자열 (D-38). errors[].field는 newPassword") String newPassword) {
	}

}

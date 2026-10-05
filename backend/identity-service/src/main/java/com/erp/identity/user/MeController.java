package com.erp.identity.user;

import java.util.UUID;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

/**
 * /api/users/me — Gateway가 access_token 쿠키를 Bearer로 옮겨 주고, 여기서 다시 검증한다 (D-19).
 */
@Tag(name = "me", description = "현재 사용자 공통 프로필 (identity가 원본, D-27)")
@RestController
@RequestMapping("/api/users/me")
public class MeController {

	public static final String USER_DELETED = "USER_DELETED";

	private final ProfileService profiles;

	public MeController(ProfileService profiles) {
		this.profiles = profiles;
	}

	@Operation(operationId = "getMe", summary = "현재 사용자 조회", security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "401", description = "UNAUTHENTICATED 또는 USER_DELETED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@GetMapping
	public Me me(@AuthenticationPrincipal Jwt jwt) {
		return profiles.get(UUID.fromString(jwt.getSubject()));
	}

	@Operation(operationId = "updateMe", summary = "공통 프로필·화면 설정 수정 (AUTH-04·05, UX-09, P1-01)",
			description = "보낸 칸만 바꾼다. version이 현재 값과 다르면 409. 프로필 칸이 바뀌면 사용자 변경 피드에 PROFILE_UPDATED를 남긴다.",
			security = @SecurityRequirement(name = "bearerAuth"),
			requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
					content = @Content(mediaType = "application/json", schema = @Schema(implementation = ProfileUpdateRequest.class))))
	@ApiResponse(responseCode = "200", description = "수정 성공(또는 바뀐 값 없음). 새 version이 담긴 현재 사용자")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED (errors[].code: REQUIRED·TOO_LONG·TIMEZONE_INVALID·WORK_DAYS_INVALID) 또는 BAD_REQUEST(형식 오류)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "UNAUTHENTICATED 또는 USER_DELETED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "409", description = "VERSION_CONFLICT (다른 곳에서 먼저 수정됨)", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@PatchMapping
	public Me update(@AuthenticationPrincipal Jwt jwt, @RequestBody JsonNode body) {
		return profiles.update(UUID.fromString(jwt.getSubject()), ProfileUpdate.parse(body));
	}

}

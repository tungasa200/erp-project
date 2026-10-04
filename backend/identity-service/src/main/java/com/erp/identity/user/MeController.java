package com.erp.identity.user;

import java.util.UUID;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.erp.common.error.ApiException;

/**
 * /api/users/me — Gateway가 access_token 쿠키를 Bearer로 옮겨 주고, 여기서 다시 검증한다 (D-19).
 */
@Tag(name = "me", description = "현재 사용자 공통 프로필 (identity가 원본, D-27)")
@RestController
@RequestMapping("/api/users/me")
public class MeController {

	public static final String USER_DELETED = "USER_DELETED";

	private final UserRepository users;

	public MeController(UserRepository users) {
		this.users = users;
	}

	@Operation(operationId = "getMe", summary = "현재 사용자 조회", security = @SecurityRequirement(name = "bearerAuth"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "401", description = "UNAUTHENTICATED 또는 USER_DELETED", content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = "#/components/schemas/Problem")))
	@GetMapping
	@Transactional(readOnly = true)
	public Me me(@AuthenticationPrincipal Jwt jwt) {
		// 서명이 맞는 토큰인데 사용자가 없으면 탈퇴한 경우다(Access Token은 최대 10분 남는다).
		return users.findById(UUID.fromString(jwt.getSubject()))
			.map(Me::of)
			.orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, USER_DELETED, "탈퇴한 사용자입니다."));
	}

}

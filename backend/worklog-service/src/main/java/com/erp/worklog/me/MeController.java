package com.erp.worklog.me;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.setting.SettingsService;
import com.erp.worklog.setting.SettingsService.Settings;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserProfileService;
import com.erp.worklog.user.UserSnapshotRepository.UserSnapshot;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/**
 * /api/worklog/me 아래 (contracts/worklog.yaml): 프로필 사본 조회·즉시 갱신, worklog 전용 설정 수정 (P0-11, P1-01).
 * 프론트 타입을 springdoc 출력에서 만들므로 이름·필수·nullable을 계약에 맞춘다.
 */
@RestController
@Tag(name = "me")
class MeController {

	static final String HH_MM = "^([01]\\d|2[0-3]):[0-5]\\d$";

	@Schema(name = "ProfileSnapshot")
	record ProfileView(
			@Schema(types = { "string", "null" }) String name,
			@Schema(types = { "string", "null" }) String organization,
			@Schema(types = { "string", "null" }) String position,
			@Schema(requiredMode = RequiredMode.REQUIRED, example = "Asia/Seoul") String timezone,
			@Schema(requiredMode = RequiredMode.REQUIRED,
					allowableValues = { "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY" })
			String weekStart,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "0", maximum = "127",
					description = "비트마스크 월=1 … 일=64, 기본 31(월~금)") int workDays,
			Instant syncedAt) {
	}

	/** worklog 전용 설정. 행이 없으면 기본값과 version 0. */
	@Schema(name = "WorklogSettings")
	record SettingsView(
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean timeTrackingEnabled,
			@Schema(requiredMode = RequiredMode.REQUIRED, pattern = HH_MM, example = "09:00",
					description = "사용자 시간대 기준 HH:mm") String workHoursStart,
			@Schema(requiredMode = RequiredMode.REQUIRED, pattern = HH_MM, example = "18:00",
					description = "workHoursStart보다 늦어야 한다 (자정 넘는 업무 시간대 없음)") String workHoursEnd,
			@Schema(requiredMode = RequiredMode.REQUIRED, pattern = HH_MM, example = "18:00",
					description = "사용자 시간대 기준 하루 마감 시각") String dailyCloseTime,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static SettingsView of(Settings s) {
			return new SettingsView(s.timeTrackingEnabled(), hhmm(s.workHoursStart()), hhmm(s.workHoursEnd()),
					hhmm(s.dailyCloseTime()), s.version());
		}

		private static String hhmm(LocalTime t) {
			return String.format("%02d:%02d", t.getHour(), t.getMinute());
		}
	}

	@Schema(name = "WorklogSettingsPatch")
	record SettingsPatch(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "마지막으로 받은 version (행이 없으면 0)")
			@NotNull(message = "REQUIRED") Long version,
			Boolean timeTrackingEnabled,
			@Schema(pattern = HH_MM) @Pattern(regexp = HH_MM, message = "INVALID_FORMAT") String workHoursStart,
			@Schema(pattern = HH_MM) @Pattern(regexp = HH_MM, message = "INVALID_FORMAT") String workHoursEnd,
			@Schema(pattern = HH_MM) @Pattern(regexp = HH_MM, message = "INVALID_FORMAT") String dailyCloseTime) {

		SettingsService.Change toChange() {
			return new SettingsService.Change(version, timeTrackingEnabled, time(workHoursStart), time(workHoursEnd),
					time(dailyCloseTime));
		}

		private static LocalTime time(String hhmm) {
			return hhmm == null ? null : LocalTime.parse(hhmm);
		}
	}

	record WorklogMe(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "UUIDv7, JWT sub와 같음") UUID userId,
			@Schema(requiredMode = RequiredMode.REQUIRED) ProfileView profile,
			@Schema(requiredMode = RequiredMode.REQUIRED) SettingsView settings) {
	}

	private final UserProfileService profiles;
	private final SettingsService settings;

	MeController(UserProfileService profiles, SettingsService settings) {
		this.profiles = profiles;
		this.settings = settings;
	}

	@GetMapping(path = "/api/worklog/me", produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "getMe", summary = "현재 사용자의 worklog 프로필 조회",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "503", description = "사본이 없고 identity 조회도 실패함 (code=PROFILE_UNAVAILABLE). 잠시 후 재시도.",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	WorklogMe me(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt) {
		return worklogMe(user, profiles.snapshotOf(user.id(), jwt.getTokenValue()));
	}

	@PostMapping(path = "/api/worklog/me/profile/refresh", produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "refreshMyProfile", summary = "공통 프로필 사본 즉시 갱신 (P1-01)",
			description = "identity에서 프로필을 저장한 직후 호출한다. identity 값이 사본보다 새것(version)일 때만 바꾼다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "갱신 후 현재 값")
	@ApiResponse(responseCode = "503", description = "identity 조회 실패 (code=PROFILE_UNAVAILABLE). 잠시 후 재시도.",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	WorklogMe refreshProfile(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt) {
		return worklogMe(user, profiles.refresh(user.id(), jwt.getTokenValue()));
	}

	@PatchMapping(path = "/api/worklog/me/settings", consumes = MediaType.APPLICATION_JSON_VALUE,
			produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateMySettings", summary = "worklog 전용 설정 수정 (P1-01, 항목별 자동 저장)",
			description = "보낸 칸만 바꾼다. 설정 행이 없으면 version=0으로 보낸다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 설정 전체")
	@ApiResponse(responseCode = "400",
			description = "입력 오류 (code=VALIDATION_FAILED). errors[].code: REQUIRED, INVALID_FORMAT, INVALID_ORDER",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "409", description = "다른 곳에서 먼저 수정됨 (code=VERSION_CONFLICT)",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	SettingsView updateSettings(@Parameter(hidden = true) CurrentUser user, @Valid @RequestBody SettingsPatch patch) {
		return SettingsView.of(settings.update(user.id(), patch.toChange()));
	}

	private WorklogMe worklogMe(CurrentUser user, UserSnapshot snapshot) {
		Profile p = snapshot.profile();
		return new WorklogMe(user.id(),
				new ProfileView(p.name(), p.organization(), p.position(), p.timezone(), p.weekStart(), p.workDays(),
						snapshot.syncedAt()),
				SettingsView.of(settings.get(user.id())));
	}
}

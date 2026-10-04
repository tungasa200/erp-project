package com.erp.worklog.me;

import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserProfileService;
import com.erp.worklog.user.UserSnapshotRepository.UserSnapshot;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * GET /api/worklog/me (contracts/worklog.yaml). 프론트 타입을 springdoc 출력에서 만들므로 이름·필수·nullable을 계약에 맞춘다.
 */
@RestController
@Tag(name = "me")
class MeController {

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

	/** worklog 전용 설정. 저장·수정은 P1-01에서 추가하며 그 전에는 기본값을 준다. */
	@Schema(name = "WorklogSettings")
	record SettingsView(
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean timeTrackingEnabled,
			@Schema(types = { "string", "null" }, pattern = HH_MM) String workHoursStart,
			@Schema(types = { "string", "null" }, pattern = HH_MM) String workHoursEnd,
			@Schema(types = { "string", "null" }, pattern = HH_MM) String dailyCloseTime) {
		static final String HH_MM = "^\\d{2}:\\d{2}$";
		static final SettingsView DEFAULTS = new SettingsView(false, null, null, null);
	}

	record WorklogMe(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "UUIDv7, JWT sub와 같음") UUID userId,
			@Schema(requiredMode = RequiredMode.REQUIRED) ProfileView profile,
			@Schema(requiredMode = RequiredMode.REQUIRED) SettingsView settings) {
	}

	private final UserProfileService profiles;

	MeController(UserProfileService profiles) {
		this.profiles = profiles;
	}

	@GetMapping(path = "/api/worklog/me", produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "getMe", summary = "현재 사용자의 worklog 프로필 조회")
	WorklogMe me(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt) {
		UserSnapshot snapshot = profiles.snapshotOf(user.id(), jwt.getTokenValue());
		Profile p = snapshot.profile();
		return new WorklogMe(user.id(),
				new ProfileView(p.name(), p.organization(), p.position(), p.timezone(), p.weekStart(), p.workDays(),
						snapshot.syncedAt()),
				SettingsView.DEFAULTS);
	}
}

package com.erp.worklog.me;

import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserProfileService;
import com.erp.worklog.user.UserSnapshotRepository.UserSnapshot;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/** GET /api/worklog/me (contracts/worklog.yaml). */
@RestController
class MeController {

	record ProfileView(String name, String organization, String position, String timezone, String weekStart,
			int workDays, Instant syncedAt) {
	}

	/** worklog 전용 설정. 저장·수정은 P1-01에서 추가하며 그 전에는 기본값을 준다. */
	record SettingsView(boolean timeTrackingEnabled, String workHoursStart, String workHoursEnd, String dailyCloseTime) {
		static final SettingsView DEFAULTS = new SettingsView(false, null, null, null);
	}

	record WorklogMe(UUID userId, ProfileView profile, SettingsView settings) {
	}

	private final UserProfileService profiles;

	MeController(UserProfileService profiles) {
		this.profiles = profiles;
	}

	@GetMapping("/api/worklog/me")
	WorklogMe me(CurrentUser user, @AuthenticationPrincipal Jwt jwt) {
		UserSnapshot snapshot = profiles.snapshotOf(user.id(), jwt.getTokenValue());
		Profile p = snapshot.profile();
		return new WorklogMe(user.id(),
				new ProfileView(p.name(), p.organization(), p.position(), p.timezone(), p.weekStart(), p.workDays(),
						snapshot.syncedAt()),
				SettingsView.DEFAULTS);
	}
}

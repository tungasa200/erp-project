package com.erp.identity.user;

import java.time.DayOfWeek;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 현재 사용자 응답 (contracts/identity.yaml Me). Profile의 칸을 같은 이름으로 모두 포함한다.
 */
@Schema(requiredProperties = { "id", "email", "emailVerified", "timezone", "weekStart", "workDays", "themeAccent",
		"themeGround", "version" })
public record Me(UUID id, String email, boolean emailVerified,
		@Schema(types = { "string", "null" }) String name,
		@Schema(types = { "string", "null" }) String organization,
		@Schema(types = { "string", "null" }) String position, String timezone, DayOfWeek weekStart, int workDays,
		String themeAccent, String themeGround, long version) {

	public static Me of(User user) {
		Profile p = user.profile();
		return new Me(user.getId(), user.getEmail(), user.getEmailVerifiedAt() != null, p.name(), p.organization(),
				p.position(), p.timezone(), p.weekStart(), p.workDays(), user.getThemeAccent(), user.getThemeGround(),
				user.getVersion());
	}

}

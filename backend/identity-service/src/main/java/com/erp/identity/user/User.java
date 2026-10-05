package com.erp.identity.user;

import java.time.DayOfWeek;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

/**
 * 계정과 공통 프로필 원본 (D-27). 로그인 수단은 UserCredential로 분리한다.
 */
@Entity
@Table(name = "users")
public class User {

	public static final String DEFAULT_TIMEZONE = "Asia/Seoul";

	/** 월~금 (월=1 … 일=64). */
	public static final short DEFAULT_WORK_DAYS = 31;

	public static final String DEFAULT_THEME_ACCENT = "#4B3FD6";

	public static final String DEFAULT_THEME_GROUND = "#F2F4FA";

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;

	private String email;

	private Instant emailVerifiedAt;

	private String name;

	private String organization;

	private String position;

	private String timezone;

	@Enumerated(EnumType.STRING)
	private DayOfWeek weekStart;

	private short workDays;

	@JdbcTypeCode(SqlTypes.CHAR)
	private String themeAccent;

	@JdbcTypeCode(SqlTypes.CHAR)
	private String themeGround;

	private boolean keyboardShortcutsEnabled;

	// 로그인 보호(LoginProtection)가 원자적 UPDATE로만 바꾼다. 엔티티 저장이 동시에 기록된 실패 횟수를 옛 값으로 덮지 않게 한다.
	@Column(updatable = false)
	private int failedLoginCount;

	@Column(updatable = false)
	private Instant lockedUntil;

	@Version
	private Long version;

	@Column(updatable = false)
	private Instant createdAt;

	private Instant updatedAt;

	protected User() {
	}

	/** 가입 직후 기본값. email은 정규화된 값이어야 한다. */
	public static User signUp(String email, Instant now) {
		User user = new User();
		user.email = email;
		user.timezone = DEFAULT_TIMEZONE;
		user.weekStart = DayOfWeek.MONDAY;
		user.workDays = DEFAULT_WORK_DAYS;
		user.themeAccent = DEFAULT_THEME_ACCENT;
		user.themeGround = DEFAULT_THEME_GROUND;
		user.keyboardShortcutsEnabled = true;
		user.createdAt = now;
		user.updatedAt = now;
		return user;
	}

	/** version은 마지막 flush 기준이다. 변경 직후 값이 필요하면 먼저 flush한다. */
	public Profile profile() {
		return new Profile(name, organization, position, timezone, weekStart, workDays, version);
	}

	/** profile: 피드로 전달하는 칸이 바뀜. any: 무엇이든 바뀜(version이 오른다). */
	public record Changes(boolean profile, boolean any) {
	}

	/** 보낸 칸만 반영한다 (ProfileUpdate). 값이 같으면 바뀐 것으로 보지 않는다. */
	public Changes apply(ProfileUpdate update, Instant now) {
		Profile before = profile();
		if (update.name() != null) {
			name = update.name().value();
		}
		if (update.organization() != null) {
			organization = update.organization().value();
		}
		if (update.position() != null) {
			position = update.position().value();
		}
		if (update.timezone() != null) {
			timezone = update.timezone();
		}
		if (update.weekStart() != null) {
			weekStart = update.weekStart();
		}
		if (update.workDays() != null) {
			workDays = update.workDays().shortValue();
		}
		boolean shortcutsChanged = update.keyboardShortcutsEnabled() != null
				&& update.keyboardShortcutsEnabled() != keyboardShortcutsEnabled;
		if (shortcutsChanged) {
			keyboardShortcutsEnabled = update.keyboardShortcutsEnabled();
		}
		boolean profileChanged = !profile().equals(before);
		if (profileChanged || shortcutsChanged) {
			updatedAt = now;
		}
		return new Changes(profileChanged, profileChanged || shortcutsChanged);
	}

	public boolean isKeyboardShortcutsEnabled() {
		return keyboardShortcutsEnabled;
	}

	public UUID getId() {
		return id;
	}

	public String getEmail() {
		return email;
	}

	public Instant getEmailVerifiedAt() {
		return emailVerifiedAt;
	}

	public String getThemeAccent() {
		return themeAccent;
	}

	public String getThemeGround() {
		return themeGround;
	}

	public Instant getLockedUntil() {
		return lockedUntil;
	}

	public Long getVersion() {
		return version;
	}

}

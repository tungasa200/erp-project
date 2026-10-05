package com.erp.worklog.setting;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcType;
import org.hibernate.type.descriptor.jdbc.LocalTimeJdbcType;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/** worklog 전용 설정 (요구사항 6장 UserSetting). 행이 없으면 {@link #defaults}로 응답한다. */
@Entity
@Table(name = "user_setting")
class UserSetting {

	static final LocalTime DEFAULT_WORK_HOURS_START = LocalTime.of(9, 0);
	static final LocalTime DEFAULT_WORK_HOURS_END = LocalTime.of(18, 0);
	static final LocalTime DEFAULT_DAILY_CLOSE_TIME = LocalTime.of(18, 0);

	@Id
	private UUID ownerId;
	private boolean timeTrackingEnabled;
	// 벽시계 시각이라 드라이버에 그대로 넘긴다. 기본 TIME 바인딩은 hibernate.jdbc.time_zone(UTC) 기준으로 JVM 시간대만큼 옮겨 저장한다
	@JdbcType(LocalTimeJdbcType.class)
	private LocalTime workHoursStart;
	@JdbcType(LocalTimeJdbcType.class)
	private LocalTime workHoursEnd;
	@JdbcType(LocalTimeJdbcType.class)
	private LocalTime dailyCloseTime;
	/** 새 행은 null이라 Spring Data가 persist로 넣고, Hibernate가 0부터 센다. */
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected UserSetting() {
	}

	static UserSetting defaults(UUID ownerId, Instant now) {
		UserSetting s = new UserSetting();
		s.ownerId = ownerId;
		s.timeTrackingEnabled = false;
		s.workHoursStart = DEFAULT_WORK_HOURS_START;
		s.workHoursEnd = DEFAULT_WORK_HOURS_END;
		s.dailyCloseTime = DEFAULT_DAILY_CLOSE_TIME;
		s.createdAt = now;
		s.updatedAt = now;
		return s;
	}

	void update(Boolean timeTrackingEnabled, LocalTime workHoursStart, LocalTime workHoursEnd, LocalTime dailyCloseTime,
			Instant now) {
		boolean changed = false;
		if (timeTrackingEnabled != null && timeTrackingEnabled != this.timeTrackingEnabled) {
			this.timeTrackingEnabled = timeTrackingEnabled;
			changed = true;
		}
		if (workHoursStart != null && !workHoursStart.equals(this.workHoursStart)) {
			this.workHoursStart = workHoursStart;
			changed = true;
		}
		if (workHoursEnd != null && !workHoursEnd.equals(this.workHoursEnd)) {
			this.workHoursEnd = workHoursEnd;
			changed = true;
		}
		if (dailyCloseTime != null && !dailyCloseTime.equals(this.dailyCloseTime)) {
			this.dailyCloseTime = dailyCloseTime;
			changed = true;
		}
		if (changed) {
			this.updatedAt = now;
		}
	}

	boolean timeTrackingEnabled() {
		return timeTrackingEnabled;
	}

	LocalTime workHoursStart() {
		return workHoursStart;
	}

	LocalTime workHoursEnd() {
		return workHoursEnd;
	}

	LocalTime dailyCloseTime() {
		return dailyCloseTime;
	}

	long version() {
		return version;
	}
}

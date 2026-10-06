package com.erp.worklog.setting;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.error.Conflicts;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** worklog 전용 설정 (P1-01). 항목별 자동 저장이라 보낸 칸만 바꾼다. */
@Service
public class SettingsService {

	public record Settings(boolean timeTrackingEnabled, LocalTime workHoursStart, LocalTime workHoursEnd,
			LocalTime dailyCloseTime, long version) {
	}

	public record Change(long version, Boolean timeTrackingEnabled, LocalTime workHoursStart, LocalTime workHoursEnd,
			LocalTime dailyCloseTime) {
	}

	private static final Settings DEFAULTS = new Settings(false, UserSetting.DEFAULT_WORK_HOURS_START,
			UserSetting.DEFAULT_WORK_HOURS_END, UserSetting.DEFAULT_DAILY_CLOSE_TIME, 0);

	private final UserSettingRepository settings;
	private final Clock clock;

	SettingsService(UserSettingRepository settings, Clock clock) {
		this.settings = settings;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public Settings get(UUID ownerId) {
		return settings.findById(ownerId).map(SettingsService::view).orElse(DEFAULTS);
	}

	/** 행이 없으면 version 0으로 받아 기본값 위에 보낸 칸을 반영해 만든다. */
	@Transactional
	public Settings update(UUID ownerId, Change change) {
		UserSetting setting = settings.findById(ownerId).orElse(null);
		boolean created = setting == null;
		if (created) {
			if (change.version() != 0) {
				throw Conflicts.versionConflict();
			}
			setting = UserSetting.defaults(ownerId, clock.instant());
		} else if (setting.version() != change.version()) {
			throw Conflicts.versionConflict();
		}
		setting.update(change.timeTrackingEnabled(), change.workHoursStart(), change.workHoursEnd(),
				change.dailyCloseTime(), clock.instant());
		if (!setting.workHoursEnd().isAfter(setting.workHoursStart())) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.",
					List.of(new FieldErrorDetail("workHoursEnd", "INVALID_ORDER", "업무 종료 시각은 시작 시각보다 늦어야 해요.")),
					Map.of());
		}
		try {
			// 응답에 바뀐 version을 실으려면 여기서 반영해야 한다
			settings.saveAndFlush(setting);
		} catch (DataIntegrityViolationException e) {
			if (created) {
				throw Conflicts.versionConflict(); // 같은 사용자의 첫 저장이 동시에 두 번 들어옴
			}
			throw e;
		}
		return view(setting);
	}

	private static Settings view(UserSetting s) {
		return new Settings(s.timeTrackingEnabled(), s.workHoursStart(), s.workHoursEnd(), s.dailyCloseTime(),
				s.version());
	}
}

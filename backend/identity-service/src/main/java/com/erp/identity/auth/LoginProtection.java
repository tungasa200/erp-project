package com.erp.identity.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;

/**
 * 계정 단위 로그인 보호 (AUTH-09): 연속 실패 시 응답 지연, 10회 실패 시 15분 잠금. 영구 잠금은 없다.
 * 실패 횟수는 원자적 UPDATE로 바꾼다. 엔티티로 바꾸면 users.version이 올라 프로필 PATCH가 409를 받는다.
 * 호출하는 쪽은 트랜잭션 밖이어야 한다: 실패 기록은 401과 함께 커밋되어야 하고, 지연 중 DB 연결을 잡지 않아야 한다.
 */
@Component
public class LoginProtection {

	public static final String AUTH_LOCKED = "AUTH_LOCKED";

	static final int MAX_FAILURES = 10;

	static final Duration LOCK_DURATION = Duration.ofMinutes(15);

	/** 이 횟수째 실패부터 지연한다: 1초, 2초, 4초, 이후 8초. */
	static final int DELAY_FROM_FAILURE = 3;

	static final Duration MAX_DELAY = Duration.ofSeconds(8);

	private final JdbcTemplate jdbc;

	private final Clock clock;

	private final Sleeper sleeper;

	public LoginProtection(JdbcTemplate jdbc, Clock clock, Sleeper sleeper) {
		this.jdbc = jdbc;
		this.clock = clock;
		this.sleeper = sleeper;
	}

	/** 잠긴 계정이면 429. 잠금 중에는 비밀번호를 비교하지 않고 실패 횟수도 늘리지 않는다(잠금 연장 방지). */
	public void rejectIfLocked(Instant lockedUntil) {
		Instant now = clock.instant();
		if (lockedUntil != null && lockedUntil.isAfter(now)) {
			throw locked(now, lockedUntil);
		}
	}

	/** 실패 1회를 기록한다. 이번 실패로 잠기면 429를 던지고, 아니면 실패 횟수만큼 응답을 늦춘다. */
	public void recordFailure(UUID userId) {
		Instant now = clock.instant();
		Instant lockUntil = now.plus(LOCK_DURATION);
		// 잠그는 순간 횟수를 0으로 되돌리므로, 갱신 후 0이면 이번 실패로 잠긴 것이다.
		List<Integer> counts = jdbc.queryForList("""
				UPDATE users SET
				  failed_login_count = CASE WHEN failed_login_count + 1 >= ? THEN 0 ELSE failed_login_count + 1 END,
				  locked_until = CASE WHEN failed_login_count + 1 >= ? THEN ? ELSE locked_until END
				WHERE id = ?
				RETURNING failed_login_count""", Integer.class, MAX_FAILURES, MAX_FAILURES,
				OffsetDateTime.ofInstant(lockUntil, ZoneOffset.UTC), userId);
		if (counts.isEmpty()) {
			return; // 그 사이 탈퇴
		}
		int failures = counts.get(0);
		if (failures == 0) {
			throw locked(now, lockUntil);
		}
		Duration delay = delayFor(failures);
		if (!delay.isZero()) {
			sleeper.sleep(delay);
		}
	}

	/** 로그인에 성공하면 실패 횟수와 지난 잠금을 지운다. */
	public void reset(UUID userId) {
		jdbc.update("UPDATE users SET failed_login_count = 0, locked_until = NULL "
				+ "WHERE id = ? AND (failed_login_count > 0 OR locked_until IS NOT NULL)", userId);
	}

	static Duration delayFor(int failures) {
		if (failures < DELAY_FROM_FAILURE) {
			return Duration.ZERO;
		}
		Duration delay = Duration.ofSeconds(1L << Math.min(failures - DELAY_FROM_FAILURE, 3));
		return delay.compareTo(MAX_DELAY) > 0 ? MAX_DELAY : delay;
	}

	private static ApiException locked(Instant now, Instant lockedUntil) {
		long seconds = Math.max(1, (Duration.between(now, lockedUntil).toMillis() + 999) / 1000);
		return new ApiException(HttpStatus.TOO_MANY_REQUESTS, AUTH_LOCKED, "로그인 시도가 많아 잠시 잠겼습니다.", List.of(),
				Map.of(Problems.RETRY_AFTER_SECONDS, seconds));
	}

	/** 응답 지연. 테스트에서 실제로 기다리지 않게 빈으로 둔다. */
	@FunctionalInterface
	public interface Sleeper {

		void sleep(Duration duration);

	}

}

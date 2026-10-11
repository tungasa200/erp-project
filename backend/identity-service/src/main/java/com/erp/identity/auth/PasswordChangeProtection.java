package com.erp.identity.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;

/**
 * 로그인 상태의 비밀번호 재확인 제한 (AUTH-07 P4-08 비밀번호 변경, AUTH-06 P4-05 탈퇴): 두 API의 불일치를 합산해
 * 15분 안에 5회 틀리면 15분 동안 두 API를 막는다.
 * 로그인 잠금(AUTH-09)과 따로 센다. 탈취된 세션이 비밀번호를 추측하는 것을 막는 용도라 로그인은 막지 않는다.
 * 메모리에 두므로 인스턴스마다 따로 세고 재시작하면 지워진다. 인스턴스가 여러 개가 되면 Redis로 옮긴다 (D-17).
 */
@Component
public class PasswordChangeProtection {

	public static final String PASSWORD_CHANGE_LOCKED = "PASSWORD_CHANGE_LOCKED";

	static final int MAX_FAILURES = 5;

	static final Duration WINDOW = Duration.ofMinutes(15);

	static final Duration LOCK_DURATION = Duration.ofMinutes(15);

	private final Cache<UUID, State> states = Caffeine.newBuilder()
		.expireAfterAccess(WINDOW.plus(LOCK_DURATION))
		.maximumSize(100_000)
		.build();

	private final Clock clock;

	public PasswordChangeProtection(Clock clock) {
		this.clock = clock;
	}

	/** 잠겨 있으면 429. 잠금 중에는 현재 비밀번호를 비교하지 않는다. */
	public void rejectIfLocked(UUID userId) {
		State state = states.getIfPresent(userId);
		if (state == null) {
			return;
		}
		Instant now = clock.instant();
		synchronized (state) {
			if (state.lockedUntil != null && state.lockedUntil.isAfter(now)) {
				throw locked(now, state.lockedUntil);
			}
		}
	}

	/** 불일치 1회를 기록한다. 이번 실패로 잠기면 429를 던진다. */
	public void recordFailure(UUID userId) {
		State state = states.get(userId, key -> new State());
		Instant now = clock.instant();
		synchronized (state) {
			Instant windowStart = now.minus(WINDOW);
			while (!state.failures.isEmpty() && !state.failures.peekFirst().isAfter(windowStart)) {
				state.failures.pollFirst();
			}
			state.failures.addLast(now);
			if (state.failures.size() >= MAX_FAILURES) {
				state.failures.clear();
				state.lockedUntil = now.plus(LOCK_DURATION);
				throw locked(now, state.lockedUntil);
			}
		}
	}

	/** 변경에 성공하면 불일치 횟수를 지운다. */
	public void reset(UUID userId) {
		states.invalidate(userId);
	}

	private static ApiException locked(Instant now, Instant lockedUntil) {
		long seconds = Math.max(1, (Duration.between(now, lockedUntil).toMillis() + 999) / 1000);
		return new ApiException(HttpStatus.TOO_MANY_REQUESTS, PASSWORD_CHANGE_LOCKED,
				"비밀번호 확인 시도가 많아 잠시 막혔습니다.", List.of(), Map.of(Problems.RETRY_AFTER_SECONDS, seconds));
	}

	private static final class State {

		private final Deque<Instant> failures = new ArrayDeque<>();

		private Instant lockedUntil;

	}

}

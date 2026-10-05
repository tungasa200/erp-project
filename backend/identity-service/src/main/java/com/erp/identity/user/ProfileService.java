package com.erp.identity.user;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;
import com.erp.identity.feed.UserFeed;

/**
 * 공통 프로필·화면 설정 수정 (AUTH-04·05, UX-09, P1-01). 프로필 칸이 바뀌면 같은 트랜잭션에 피드를 남긴다 (5.4).
 */
@Service
public class ProfileService {

	private final UserRepository users;

	private final UserFeed feed;

	private final Clock clock;

	public ProfileService(UserRepository users, UserFeed feed, Clock clock) {
		this.users = users;
		this.feed = feed;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public Me get(UUID userId) {
		return Me.of(find(userId));
	}

	@Transactional
	public Me update(UUID userId, ProfileUpdate update) {
		User user = find(userId);
		if (user.getVersion() != update.version()) {
			throw versionConflict();
		}
		Instant now = clock.instant();
		User.Changes changes = user.apply(update, now);
		if (changes.any()) {
			try {
				// 응답과 피드에 올라간 version을 담으려고 바로 반영한다. 그 사이 다른 수정이 커밋됐으면 여기서 실패한다.
				users.flush();
			}
			catch (ObjectOptimisticLockingFailureException ex) {
				throw versionConflict();
			}
		}
		if (changes.profile()) {
			feed.profileUpdated(userId, user.profile(), now);
		}
		return Me.of(user);
	}

	private User find(UUID userId) {
		// 서명이 맞는 토큰인데 사용자가 없으면 탈퇴한 경우다(Access Token은 최대 10분 남는다).
		return users.findById(userId)
			.orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, MeController.USER_DELETED, "탈퇴한 사용자입니다."));
	}

	private static ApiException versionConflict() {
		return new ApiException(HttpStatus.CONFLICT, Problems.VERSION_CONFLICT, "다른 곳에서 먼저 수정됐어요. 새로 불러와 주세요.");
	}

}

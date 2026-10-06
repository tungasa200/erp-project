package com.erp.worklog.user;

import com.erp.common.error.ApiException;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.user.UserSnapshotRepository.UserSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class UserProfileService {

	private static final Logger log = LoggerFactory.getLogger(UserProfileService.class);

	private final UserSnapshotRepository snapshots;
	private final IdentityClient identity;

	UserProfileService(UserSnapshotRepository snapshots, IdentityClient identity) {
		this.snapshots = snapshots;
		this.identity = identity;
	}

	/**
	 * 사본을 돌려준다. 가입 직후라 피드가 아직 오지 않았으면 사용자 토큰으로 identity를 바로 조회해 저장한다 (5.4).
	 */
	public UserSnapshot snapshotOf(UUID userId, String userToken) {
		return snapshots.find(userId).orElseGet(() -> {
			snapshots.insertIfAbsent(userId, fetch(userToken, "사본이 없고 identity 조회도 실패"));
			return snapshots.find(userId).orElseThrow();
		});
	}

	/**
	 * 프로필 저장 직후 프론트가 부른다 (5.4 "프로필 재조회"). identity 값이 사본보다 새것일 때만 바꾼다.
	 * 피드가 먼저 더 새 값을 넣었으면 그것을 둔다.
	 */
	public UserSnapshot refresh(UUID userId, String userToken) {
		snapshots.upsert(userId, fetch(userToken, "프로필 즉시 갱신 중 identity 조회 실패"), 0);
		return snapshots.find(userId).orElseThrow();
	}

	private Profile fetch(String userToken, String failureLog) {
		try {
			return identity.me(userToken);
		} catch (IdentityClient.UserDeletedException e) {
			throw DeletedUserInterceptor.userDeleted();
		} catch (IdentityClient.IdentityUnavailableException e) {
			log.warn("{}: {}", failureLog, e.toString());
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PROFILE_UNAVAILABLE",
					"프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
		}
	}
}

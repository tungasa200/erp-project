package com.erp.identity.user;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.erp.identity.feed.UserFeed;

/**
 * 회원 탈퇴 (AUTH-06). API는 P4에서 추가하고, 지금은 이 메서드와 그 결과(피드·탈퇴 기록)만 확정한다.
 * 사용자 행을 실제로 지워 같은 이메일로 바로 다시 가입할 수 있다(새 ID 발급).
 */
@Service
public class UserDeletionService {

	private final JdbcTemplate jdbc;

	private final UserFeed feed;

	private final Clock clock;

	public UserDeletionService(JdbcTemplate jdbc, UserFeed feed, Clock clock) {
		this.jdbc = jdbc;
		this.feed = feed;
		this.clock = clock;
	}

	/**
	 * 한 트랜잭션에서 사용자·로그인 수단·Refresh Token을 지우고(FK ON DELETE CASCADE) 탈퇴 기록과 DELETED 이벤트를 남긴다.
	 * 이미 없는 사용자면 아무것도 하지 않는다.
	 */
	@Transactional
	public void delete(UUID userId) {
		if (jdbc.update("DELETE FROM users WHERE id = ?", userId) == 0) {
			return;
		}
		Instant now = clock.instant();
		jdbc.update("INSERT INTO deleted_users (user_id, deleted_at) VALUES (?, ?)", userId,
				OffsetDateTime.ofInstant(now, ZoneOffset.UTC));
		feed.deleted(userId, now);
	}

}

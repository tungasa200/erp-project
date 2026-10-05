package com.erp.worklog.user;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * 탈퇴 사용자의 worklog 데이터를 파기한다 (AUTH-06). 멱등이라 15분 뒤 재파기에도 그대로 쓴다.
 * owner_id를 가진 테이블을 추가하면 여기에 삭제를 함께 넣는다.
 */
@Component
public class UserDataPurger {

	private final UserSnapshotRepository snapshots;
	private final JdbcClient jdbc;

	UserDataPurger(UserSnapshotRepository snapshots, JdbcClient jdbc) {
		this.snapshots = snapshots;
		this.jdbc = jdbc;
	}

	@Transactional
	public void purge(UUID userId) {
		jdbc.sql("DELETE FROM user_setting WHERE owner_id = ?").param(userId).update();
		snapshots.delete(userId);
	}
}

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
		// 업무가 프로젝트를 가리키므로 업무부터 지운다. task_tag는 ON DELETE CASCADE
		// 일정이 업무를 가리키므로(schedule.task_id → task) 일정을 맨 앞에 지운다. schedule_exception은 ON DELETE CASCADE
		// 기록이 업무·일정을 가리키므로(work_record.task_id·schedule_id) 기록을 가장 먼저 지운다
		for (String table : new String[] { "work_record", "schedule", "task", "tag", "project", "user_setting" }) {
			jdbc.sql("DELETE FROM " + table + " WHERE owner_id = ?").param(userId).update();
		}
		snapshots.delete(userId);
	}
}

package com.erp.worklog.user;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;

/**
 * 사용자 연동 주기 작업 (D-31, D-45). ShedLock으로 인스턴스가 여러 개여도 한 곳에서만 돈다.
 */
@Component
class UserSyncJobs {

	private static final Logger log = LoggerFactory.getLogger(UserSyncJobs.class);

	/** Access Token 수명(10분)보다 길게 기다려, 탈퇴 직전에 처리 중이던 요청이 쓴 데이터까지 지운다. */
	static final Duration REPURGE_AFTER = Duration.ofMinutes(15);
	static final Duration KEEP_DELETED_USERS = Duration.ofDays(7);

	private final UserSyncService sync;
	private final DeletedUserRepository deletedUsers;
	private final UserDataPurger purger;
	private final Clock clock;

	UserSyncJobs(UserSyncService sync, DeletedUserRepository deletedUsers, UserDataPurger purger, Clock clock) {
		this.sync = sync;
		this.deletedUsers = deletedUsers;
		this.purger = purger;
		this.clock = clock;
	}

	@Scheduled(fixedDelayString = "${worklog.feed.poll-interval:30s}", initialDelayString = "${worklog.feed.initial-delay:10s}")
	@SchedulerLock(name = "worklog.userFeedPoll", lockAtMostFor = "5m")
	void pollFeed() {
		try {
			sync.poll();
		} catch (RuntimeException e) {
			// 다음 주기에 커서부터 다시 한다
			log.warn("사용자 변경 피드 가져오기 실패: {}", e.toString());
		}
	}

	@Scheduled(fixedDelayString = "${worklog.deleted-user.repurge-interval:5m}")
	@SchedulerLock(name = "worklog.deletedUserRepurge", lockAtMostFor = "10m")
	void repurge() {
		for (UUID userId : deletedUsers.findNotRepurgedBefore(clock.instant().minus(REPURGE_AFTER))) {
			purger.purge(userId);
			deletedUsers.markRepurged(userId);
		}
	}

	@Scheduled(cron = "${worklog.deleted-user.cleanup-cron:0 30 3 * * *}", zone = "UTC")
	@SchedulerLock(name = "worklog.deletedUserCleanup", lockAtMostFor = "30m")
	void cleanupDeletedUsers() {
		int removed = deletedUsers.deleteRepurgedBefore(clock.instant().minus(KEEP_DELETED_USERS));
		if (removed > 0) {
			log.info("7일 지난 탈퇴 사용자 거부 목록 {}건 정리", removed);
		}
	}
}

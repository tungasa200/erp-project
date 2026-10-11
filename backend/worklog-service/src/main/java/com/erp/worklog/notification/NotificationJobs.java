package com.erp.worklog.notification;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

/** 30일 지난 알림 정리 (P4-01, contracts/worklog.yaml listNotifications). */
@Component
class NotificationJobs {

	private static final Logger log = LoggerFactory.getLogger(NotificationJobs.class);
	static final Duration KEEP = Duration.ofDays(30);

	private final NotificationRepository notifications;
	private final Clock clock;

	NotificationJobs(NotificationRepository notifications, Clock clock) {
		this.notifications = notifications;
		this.clock = clock;
	}

	@Scheduled(cron = "${worklog.notification.cleanup-cron:0 40 3 * * *}", zone = "UTC")
	@SchedulerLock(name = "worklog.notificationCleanup", lockAtMostFor = "30m")
	void cleanup() {
		int removed = notifications.deleteCreatedBefore(clock.instant().minus(KEEP));
		if (removed > 0) {
			log.info("30일 지난 알림 {}건 정리", removed);
		}
	}
}

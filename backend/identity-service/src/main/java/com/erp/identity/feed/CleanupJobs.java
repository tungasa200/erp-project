package com.erp.identity.feed;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 정리 작업 (P0-11, D-31). 인스턴스 하나에서만 돈다(ShedLock).
 * 인증 코드 정리는 이메일 인증(AUTH-08)을 만들 때 추가한다.
 * ShedLock 프록시는 잠금을 못 잡으면 실행을 건너뛰므로 반환값을 두지 않는다.
 */
@Component
public class CleanupJobs {

	static final Duration FEED_RETENTION = Duration.ofDays(30);

	private final JdbcTemplate jdbc;

	private final Clock clock;

	public CleanupJobs(JdbcTemplate jdbc, Clock clock) {
		this.jdbc = jdbc;
		this.clock = clock;
	}

	/** 만료된 Refresh Token. 폐기됐지만 만료 전인 토큰은 재사용 탐지에 필요해서 남긴다. */
	@Scheduled(cron = "${identity.cleanup.cron:0 17 * * * *}", zone = "UTC")
	@SchedulerLock(name = "identity.purgeExpiredRefreshTokens")
	@Transactional
	public void purgeExpiredRefreshTokens() {
		jdbc.update("DELETE FROM refresh_tokens WHERE expires_at < ?", now());
	}

	/**
	 * 30일 지난 피드. 지운 마지막 seq를 pruned_through에 남겨, 그 앞을 요청하는 소비자에게 410을 준다.
	 * created_at이 아니라 seq 기준으로 잘라 지우므로 남은 행은 모두 pruned_through보다 크다.
	 */
	@Scheduled(cron = "${identity.cleanup.cron:0 17 * * * *}", zone = "UTC")
	@SchedulerLock(name = "identity.pruneUserFeed")
	@Transactional
	public void pruneUserFeed() {
		OffsetDateTime cutoff = now().minus(FEED_RETENTION);
		Long maxSeq = jdbc.queryForObject("SELECT max(seq) FROM user_events WHERE created_at < ?", Long.class, cutoff);
		if (maxSeq == null) {
			return;
		}
		jdbc.update("DELETE FROM user_events WHERE seq <= ?", maxSeq);
		jdbc.update("UPDATE feed_retention SET pruned_through = GREATEST(pruned_through, ?) WHERE id = 1", maxSeq);
	}

	private OffsetDateTime now() {
		return OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
	}

}

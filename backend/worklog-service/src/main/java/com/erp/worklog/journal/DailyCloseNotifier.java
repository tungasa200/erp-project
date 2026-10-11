package com.erp.worklog.journal;

import com.erp.worklog.notification.NotificationRepository;
import com.erp.worklog.notification.NotifyScheduleChanged;
import com.erp.worklog.notification.PushSender;
import com.erp.worklog.notification.PushSender.Message;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserSnapshotRepository;
import com.erp.worklog.workrecord.WorkRecordService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 하루 마감 알림 (P4-01, NOTI-01, 카드 0401, contracts/worklog.yaml PATCH /me/settings 설명).
 * user_setting.next_notify_at이 지난 사용자에게 알림 센터 항목을 만들고 웹 푸시를 보낸 뒤 다음 근무일의 마감 시각으로 옮긴다.
 */
@Component
class DailyCloseNotifier {

	private static final Logger log = LoggerFactory.getLogger(DailyCloseNotifier.class);

	/** 서버가 멈춰 이보다 늦은 알림은 보내지 않는다. */
	static final Duration MAX_LATE = Duration.ofHours(1);
	static final int BATCH = 200;
	static final String TITLE = "하루 마감 시간이에요";

	private record Due(UUID ownerId, LocalTime closeTime, Instant at) {
	}

	private final JdbcClient jdbc;
	private final UserSnapshotRepository snapshots;
	private final Holidays holidays;
	private final WorkRecordService records;
	private final NotificationRepository notifications;
	private final PushSender push;
	private final TransactionTemplate tx;
	private final Clock clock;

	DailyCloseNotifier(JdbcClient jdbc, UserSnapshotRepository snapshots, Holidays holidays, WorkRecordService records,
			NotificationRepository notifications, PushSender push, TransactionTemplate tx, Clock clock) {
		this.jdbc = jdbc;
		this.snapshots = snapshots;
		this.holidays = holidays;
		this.records = records;
		this.notifications = notifications;
		this.push = push;
		this.tx = tx;
		this.clock = clock;
	}

	@Scheduled(fixedDelayString = "${worklog.notify.interval:60s}", initialDelayString = "${worklog.notify.initial-delay:20s}")
	@SchedulerLock(name = "worklog.dailyCloseNotify", lockAtMostFor = "10m")
	void run() {
		Instant now = clock.instant();
		List<Due> due = jdbc.sql("""
				SELECT owner_id, daily_close_time, next_notify_at FROM user_setting
				WHERE daily_close_notify_enabled AND next_notify_at <= :now
				ORDER BY next_notify_at LIMIT :batch""")
			.param("now", utc(now)).param("batch", BATCH)
			.query((rs, i) -> new Due(rs.getObject("owner_id", UUID.class), rs.getObject("daily_close_time", LocalTime.class),
					rs.getObject("next_notify_at", OffsetDateTime.class).toInstant()))
			.list();
		for (Due d : due) {
			try {
				// 알림·다음 시각은 한 트랜잭션, 푸시는 커밋 뒤(푸시 서비스를 기다리는 동안 DB 연결을 잡지 않도록)
				tx.execute(status -> notifyOne(d, now)).ifPresent(m -> push.send(d.ownerId(), m));
			} catch (RuntimeException e) {
				// 다음 주기에 다시 한다(같은 날 알림은 한 번만 만들어진다)
				log.warn("하루 마감 알림 실패: {}", e.toString());
			}
		}
	}

	private Optional<Message> notifyOne(Due d, Instant now) {
		Profile profile = snapshots.find(d.ownerId()).map(s -> s.profile()).orElse(null);
		if (profile == null) {
			// 사본이 생기면(피드) 다시 계산된다
			setNext(d, null);
			return Optional.empty();
		}
		ZoneId zone = ZoneId.of(profile.timezone());
		WorkCalendar cal = WorkCalendar.of(profile, holidays);
		LocalDate date = d.at().atZone(zone).toLocalDate();
		Optional<Message> message = Optional.empty();
		boolean late = Duration.between(d.at(), now).compareTo(MAX_LATE) > 0;
		if (!late && cal.workday(date) && !confirmed(d.ownerId(), LogType.DAILY, date)) {
			int pending = records.pendingCount(d.ownerId(), profile::timezone);
			message = notifications.insert(d.ownerId(), "DAILY_CLOSE", date, pending, null, null, now)
				.map(id -> new Message("DAILY_CLOSE", id, TITLE, pending == 0 ? null : "확인 대기 기록 " + pending + "건을 확인해 주세요.",
						"/logs/daily/" + date + "?close=1"));
			suggest(d.ownerId(), cal, date, now);
		}
		// 처리한 날의 마감 시각보다 뒤에서 찾는다(같은 날을 두 번 잡지 않도록)
		Instant closedAt = ZonedDateTime.of(date, d.closeTime(), zone).toInstant();
		setNext(d, next(cal, zone, d.closeTime(), closedAt.isAfter(now) ? closedAt : now));
		return message;
	}

	/** 그날이 주(월)의 마지막 근무일이면 주간 → 월간 일지 만들 차례 (LOG-16). 이미 확정한 일지는 빼고, 푸시는 하지 않는다. */
	private void suggest(UUID ownerId, WorkCalendar cal, LocalDate date, Instant now) {
		LocalDate week = cal.weekStartOf(date);
		if (date.equals(cal.lastWorkday(week, LogType.WEEKLY.end(week))) && !confirmed(ownerId, LogType.WEEKLY, week)) {
			notifications.insert(ownerId, "LOG_SUGGESTION", date, null, "WEEKLY", week, now);
		}
		LocalDate month = date.withDayOfMonth(1);
		if (date.equals(cal.lastWorkday(month, LogType.MONTHLY.end(month))) && !confirmed(ownerId, LogType.MONTHLY, month)) {
			// 같은 날 두 제안의 순서가 목록에서 주간 → 월간이 되도록 1마이크로초 늦게 만든다(최신순이라 월간이 위)
			notifications.insert(ownerId, "LOG_SUGGESTION", date, null, "MONTHLY", month, now.plusNanos(1000));
		}
	}

	/** 마감 시각·알림 켜기·프로필 시간대·업무 요일이 바뀐 트랜잭션 안에서 다음 알림 시각을 다시 계산한다 (5.6). */
	@EventListener
	void onScheduleChanged(NotifyScheduleChanged event) {
		UUID ownerId = event.ownerId();
		jdbc.sql("SELECT daily_close_notify_enabled, daily_close_time FROM user_setting WHERE owner_id = ?")
			.param(ownerId)
			.query((rs, i) -> new Object[] { rs.getBoolean(1), rs.getObject(2, LocalTime.class) })
			.optional()
			.ifPresent(row -> {
				Instant next = null;
				Profile profile = snapshots.find(ownerId).map(s -> s.profile()).orElse(null);
				if ((boolean) row[0] && profile != null) {
					next = next(WorkCalendar.of(profile, holidays), ZoneId.of(profile.timezone()), (LocalTime) row[1],
							clock.instant());
				}
				jdbc.sql("UPDATE user_setting SET next_notify_at = :next WHERE owner_id = :owner")
					.param("next", next == null ? null : utc(next), java.sql.Types.TIMESTAMP_WITH_TIMEZONE)
					.param("owner", ownerId)
					.update();
			});
	}

	/** after보다 뒤인 첫 근무일의 마감 시각(사용자 시간대). 근무일이 하나도 없는 설정이면 다음 날(보낼 때 다시 건너뛴다). */
	static Instant next(WorkCalendar cal, ZoneId zone, LocalTime closeTime, Instant after) {
		LocalDate d = after.atZone(zone).toLocalDate();
		if (!cal.workday(d) || !ZonedDateTime.of(d, closeTime, zone).toInstant().isAfter(after)) {
			d = cal.nextWorkday(d);
		}
		return ZonedDateTime.of(d, closeTime, zone).toInstant();
	}

	private boolean confirmed(UUID ownerId, LogType type, LocalDate periodStart) {
		return jdbc.sql("""
				SELECT EXISTS (SELECT 1 FROM work_log
				               WHERE owner_id = :owner AND type = :type AND period_start = :start AND status = 'CONFIRMED')""")
			.param("owner", ownerId).param("type", type.name()).param("start", periodStart)
			.query(Boolean.class).single();
	}

	/** 그 사이 설정이 바뀌어 다시 계산됐으면(next_notify_at이 다름) 그 값을 둔다. */
	private void setNext(Due d, Instant next) {
		jdbc.sql("UPDATE user_setting SET next_notify_at = :next WHERE owner_id = :owner AND next_notify_at = :at")
			.param("next", next == null ? null : utc(next), java.sql.Types.TIMESTAMP_WITH_TIMEZONE)
			.param("owner", d.ownerId()).param("at", utc(d.at()))
			.update();
	}

	private static OffsetDateTime utc(Instant at) {
		return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
	}
}

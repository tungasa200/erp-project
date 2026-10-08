package com.erp.worklog.journal;

import com.erp.common.error.FieldErrorDetail;
import com.erp.worklog.journal.LogBuilder.Context;
import com.erp.worklog.journal.WorkLogRepository.Row;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 기간별 일지 상태 (P3-08 LOG-09 SCR-LOG-01, 홈 이번 주 현황 SCR-HOME-01 ⑦, 하루 마감 제안 LOG-16).
 * 상태: 저장된 일지면 DRAFT·CONFIRMED, 없으면 원본이 있을 때 NOT_WRITTEN, 없으면 NO_RECORDS. 호출하는 쪽의 트랜잭션 안에서 부른다.
 */
@Component
class LogPeriods {

	static final int MAX_RANGE_DAYS = 400;

	@Schema(name = "LogPeriodDays", description = "WEEKLY·MONTHLY만. \"확정 4/5일\" 표시용 (SCR-LOG-01 ③)")
	record Days(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "기간 안 근무일 수") int workdays,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "기간 안 일간 일지가 확정인 날 수 (비근무일 확정 포함)") int confirmed) {
	}

	@Schema(name = "LogPeriod", description = "일지 목록 한 줄 (SCR-LOG-01, SCR-HOME-01 ⑦)")
	record Period(
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "DAILY", "WEEKLY", "MONTHLY" }) String type,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate periodStart,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "양끝 포함") LocalDate periodEnd,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "NO_RECORDS", "NOT_WRITTEN", "DRAFT", "CONFIRMED" }) String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID logId,
			@Schema(types = { "boolean", "null" }, description = "DAILY만. 근무일인지 (D-37). 휴일 = false") Boolean workday,
			@Schema(types = { "string", "null" }, description = "DAILY만. 공휴일 이름 (D-74), 아니면 null") String holiday,
			@Schema(description = "WEEKLY·MONTHLY만") Days days) {
	}

	private final WorkLogRepository logs;
	private final LogSources sources;

	LogPeriods(WorkLogRepository logs, LogSources sources) {
		this.logs = logs;
		this.sources = sources;
	}

	/** [from, to]와 겹치는 기간마다 한 줄 (일지가 없는 기간도). periodStart 오름차순. */
	List<Period> list(Context c, LogType type, LocalDate from, LocalDate to) {
		List<LocalDate> starts = new ArrayList<>();
		for (LocalDate s = type.startOf(from, c.calendar()); !s.isAfter(to); s = next(type, s)) {
			starts.add(s);
		}
		LocalDate first = starts.getFirst();
		LocalDate last = type.end(starts.getLast());
		Map<LocalDate, Row> saved = new HashMap<>();
		logs.findStarting(c.ownerId(), type, first, last).forEach(r -> saved.put(r.periodStart(), r));
		Set<LocalDate> sourceDates = sources.sourceDates(c.ownerId(), c.zone(), first, last);
		Set<LocalDate> confirmedDays = type == LogType.DAILY ? Set.of() : confirmedDailyDates(c, first, last);

		List<Period> result = new ArrayList<>();
		for (LocalDate s : starts) {
			LocalDate e = type.end(s);
			Row row = saved.get(s);
			String status = row != null ? (row.confirmed() ? "CONFIRMED" : "DRAFT")
					: hasAny(sourceDates, s, e) ? "NOT_WRITTEN" : "NO_RECORDS";
			UUID logId = row == null ? null : row.id();
			if (type == LogType.DAILY) {
				result.add(new Period(type.name(), s, e, status, logId, c.calendar().workday(s), c.calendar().holiday(s), null));
			}
			else {
				int workdays = 0;
				int confirmed = 0;
				for (LocalDate d = s; !d.isAfter(e); d = d.plusDays(1)) {
					workdays += c.calendar().workday(d) ? 1 : 0;
					confirmed += confirmedDays.contains(d) ? 1 : 0;
				}
				result.add(new Period(type.name(), s, e, status, logId, null, null, new Days(workdays, confirmed)));
			}
		}
		return result;
	}

	Period period(Context c, LogType type, LocalDate start) {
		return list(c, type, start, start).getFirst();
	}

	/** [from, min(to, 오늘)] 중 원본이 있는데 일간 일지가 확정이 아닌 날 수 (SCR-LOG-01 ⑤ 상단 띠). */
	int unconfirmedDays(Context c, LocalDate from, LocalDate to) {
		LocalDate until = to.isAfter(c.today()) ? c.today() : to;
		if (until.isBefore(from)) {
			return 0;
		}
		Set<LocalDate> confirmed = confirmedDailyDates(c, from, until);
		int count = 0;
		for (LocalDate d : sources.sourceDates(c.ownerId(), c.zone(), from, until)) {
			count += confirmed.contains(d) ? 0 : 1;
		}
		return count;
	}

	/** 기간 안 근무일 중 일간 일지가 확정이 아닌 날 (LOG-16 제안의 미확정 일). */
	List<LocalDate> unconfirmedWorkdays(Context c, LocalDate from, LocalDate to) {
		Set<LocalDate> confirmed = confirmedDailyDates(c, from, to);
		List<LocalDate> result = new ArrayList<>();
		for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
			if (c.calendar().workday(d) && !confirmed.contains(d)) {
				result.add(d);
			}
		}
		return result;
	}

	/** from·to 필수, to ≥ from, 최대 400일. */
	static void checkRange(LocalDate from, LocalDate to, List<FieldErrorDetail> errors) {
		if (from == null) {
			errors.add(WorkLogService.error("from", "REQUIRED"));
		}
		if (to == null) {
			errors.add(WorkLogService.error("to", "REQUIRED"));
		}
		else if (from != null && to.isBefore(from)) {
			errors.add(WorkLogService.error("to", "INVALID_ORDER"));
		}
		else if (from != null && ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS) {
			errors.add(WorkLogService.error("to", "OUT_OF_RANGE"));
		}
	}

	private Set<LocalDate> confirmedDailyDates(Context c, LocalDate from, LocalDate to) {
		Set<LocalDate> dates = new java.util.HashSet<>();
		for (Row r : logs.findStarting(c.ownerId(), LogType.DAILY, from, to)) {
			if (r.confirmed()) {
				dates.add(r.periodStart());
			}
		}
		return dates;
	}

	private static boolean hasAny(Set<LocalDate> dates, LocalDate from, LocalDate to) {
		for (LocalDate d : dates) {
			if (!d.isBefore(from) && !d.isAfter(to)) {
				return true;
			}
		}
		return false;
	}

	private static LocalDate next(LogType type, LocalDate start) {
		return switch (type) {
			case DAILY -> start.plusDays(1);
			case WEEKLY -> start.plusDays(7);
			case MONTHLY -> start.plusMonths(1);
		};
	}
}

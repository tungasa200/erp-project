package com.erp.worklog.journal;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.journal.LogBuilder.Context;
import com.erp.worklog.journal.LogBuilder.Draft;
import com.erp.worklog.journal.LogPeriods.Period;
import com.erp.worklog.journal.LogSources.Rec;
import com.erp.worklog.journal.LogSources.TaskInfo;
import com.erp.worklog.journal.LogViews.Plan;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.journal.WorkLogRepository.Row;
import com.erp.worklog.user.Profile;
import com.erp.worklog.workrecord.WorkRecordService;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * 하루 마감 (P3-05 LOG-13·14·16, SCR-LOG-03)과 일지 목록 (P3-08 LOG-09, SCR-LOG-01).
 * 마감은 WorkLogService의 만들기 → 고치기 → 확정을 한 트랜잭션으로 묶는다.
 */
@Service
class DailyCloseService {

	static final int MAX_PLANS = 50;
	static final int MAX_ISSUES = 2000;

	@Schema(name = "LogPeriodList")
	record PeriodList(
			@Schema(requiredMode = RequiredMode.REQUIRED) List<Period> items,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "[from, min(to, 오늘)] 중 원본이 있는데 일간 일지가 확정이 아닌 날 수 (SCR-LOG-01 ⑤)") int unconfirmedDays) {
	}

	@Schema(name = "CarryOverCandidate")
	record CarryOver(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID taskId,
			@Schema(requiredMode = RequiredMode.REQUIRED) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" }) String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date") LocalDate dueDate,
			@Schema(requiredMode = RequiredMode.REQUIRED) int progress,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "uuid") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "기본 선택 (LOG-14 — 늘 true)") boolean selected) {
	}

	@Schema(name = "LogSuggestion")
	record Suggestion(
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "WEEKLY", "MONTHLY" }) String type,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate periodStart,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate periodEnd,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "NO_RECORDS", "NOT_WRITTEN", "DRAFT", "CONFIRMED" }) String logStatus,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "기간 안 근무일 중 일간 일지가 확정이 아닌 날 (LOG-16)")) List<LocalDate> unconfirmedDates) {
	}

	@Schema(name = "DailyClosePlan")
	record ClosePlan(
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate date,
			@Schema(requiredMode = RequiredMode.REQUIRED) Period log,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "최근 7일 확인 대기 수 (GET /records/pending과 같은 범위)") int pendingCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<CarryOver> carryOverCandidates,
			@Schema(requiredMode = RequiredMode.REQUIRED) LocalDate nextWorkday,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "NEXT_WORKDAY", "NEXT_WEEK" }) String planScope,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<Suggestion> suggestions) {
	}

	@Schema(name = "DailyCloseRequest")
	record CloseRequest(
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "그날 일간 일지의 version, 없으면 0") @NotNull(message = "REQUIRED") Long version,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "계획으로 넘길 업무 (빈 배열 가능). 내 것이 아니거나 보관한 업무는 400(NOT_FOUND)")
			@NotNull(message = "REQUIRED") @Size(max = 50, message = "TOO_MANY") List<UUID> carryOverTaskIds,
			@Schema(types = { "string", "null" }, maxLength = 500, description = "이슈 한 줄 (비워 둘 수 있음)")
			@Size(max = 500, message = "TOO_LONG") String issue) {
	}

	@Schema(name = "DailyCloseResult")
	record CloseResult(
			@Schema(requiredMode = RequiredMode.REQUIRED) WorkLogView log,
			@ArraySchema(arraySchema = @Schema(requiredMode = RequiredMode.REQUIRED,
					description = "주간 → 월간 순 (LOG-16). 해당 없으면 빈 배열")) List<Suggestion> suggestions) {
	}

	private final WorkLogService logService;
	private final WorkLogRepository logs;
	private final LogPeriods periods;
	private final LogSources sources;
	private final WorkRecordService records;
	private final JdbcClient jdbc;
	private final Clock clock;

	DailyCloseService(WorkLogService logService, WorkLogRepository logs, LogPeriods periods, LogSources sources,
			WorkRecordService records, JdbcClient jdbc, Clock clock) {
		this.logService = logService;
		this.logs = logs;
		this.periods = periods;
		this.sources = sources;
		this.records = records;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	PeriodList list(UUID ownerId, Profile profile, LogType type, LocalDate from, LocalDate to) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		LogPeriods.checkRange(from, to, errors);
		WorkLogService.throwIfAny(errors);
		Context c = logService.context(ownerId, profile);
		return new PeriodList(periods.list(c, type, from, to), periods.unconfirmedDays(c, from, to));
	}

	/** 마감 준비. 확인 대기 수를 세면서 확인 대기를 만들 수 있어 쓰기 트랜잭션이다 (GET /records/pending과 같다). */
	@Transactional
	ClosePlan plan(UUID ownerId, Profile profile, LocalDate date) {
		Context c = logService.context(ownerId, profile);
		WorkCalendar cal = c.calendar();
		Period log = periods.period(c, LogType.DAILY, date);
		int pending = records.pendingCount(ownerId, profile::timezone);
		LocalDate next = cal.nextWorkday(date);
		LogViews.Period planPeriod = LogBuilder.planPeriod(cal, LogType.DAILY, date);
		String scope = planPeriod.start().equals(planPeriod.end()) ? "NEXT_WORKDAY" : "NEXT_WEEK";
		return new ClosePlan(date, log, pending, carryOvers(c, date, next), next, scope, suggestions(c, date));
	}

	/** 마감: 초안이 없으면 만들고 → 이월 업무를 계획에 더하고 → 이슈 한 줄을 덧붙이고 → 확정. */
	@Transactional
	CloseResult close(UUID ownerId, Profile profile, LocalDate date, CloseRequest request) {
		Context c = logService.context(ownerId, profile);
		List<FieldErrorDetail> errors = new ArrayList<>();
		if (date.isAfter(c.today())) {
			errors.add(WorkLogService.error("date", "OUT_OF_RANGE"));
		}
		List<UUID> taskIds = request.carryOverTaskIds().stream().filter(Objects::nonNull).distinct().toList();
		Map<UUID, String> titles = activeTaskTitles(ownerId, taskIds);
		if (titles.size() != taskIds.size()) {
			errors.add(WorkLogService.error("carryOverTaskIds", "NOT_FOUND"));
		}
		WorkLogService.throwIfAny(errors);

		Row row = logs.find(ownerId, LogType.DAILY, date).orElse(null);
		long version = request.version();
		if (row == null) {
			if (version != 0) {
				throw Conflicts.versionConflict();
			}
			version = logService.create(ownerId, profile, "daily", date).log().version();
			row = logs.find(ownerId, LogType.DAILY, date).orElseThrow();
		}
		if (row.confirmed()) {
			throw new ApiException(HttpStatus.CONFLICT, "LOG_CONFIRMED", "확정 해제 후 다시 마감할 수 있어요.");
		}
		Draft draft = logService.read(row.content(), Draft.class);

		List<Plan> plans = new ArrayList<>(draft.plans());
		Set<UUID> planned = new HashSet<>();
		plans.stream().map(Plan::taskId).filter(Objects::nonNull).forEach(planned::add);
		for (UUID id : taskIds) {
			if (planned.add(id)) {
				plans.add(new Plan(WorkLogService.uuidV7(clock.instant()), titles.get(id), id, null, null));
			}
		}
		if (plans.size() > MAX_PLANS) {
			errors.add(WorkLogService.error("carryOverTaskIds", "TOO_MANY"));
		}
		String issues = draft.issues();
		String issue = request.issue() == null ? "" : request.issue().strip();
		if (!issue.isEmpty()) {
			issues = issues == null ? issue : issues + "\n" + issue;
			if (issues.length() > MAX_ISSUES) {
				errors.add(WorkLogService.error("issue", "TOO_LONG"));
			}
		}
		WorkLogService.throwIfAny(errors);

		WorkLogView patched = logService.patch(ownerId, profile, row.id(),
				new WorkLogService.Change(version, null, plans, true, issues));
		WorkLogView confirmed = logService.confirm(ownerId, profile, row.id(), patched.version());
		return new CloseResult(confirmed, suggestions(c, date));
	}

	/** 이월 후보 (LOG-14): 그날 확정 기록이 있거나, 마감일이 다음 근무일 이하이거나, 진행 중인 할 일·진행 중 업무. 마감순 → 제목. */
	private List<CarryOver> carryOvers(Context c, LocalDate date, LocalDate nextWorkday) {
		Set<UUID> recorded = new HashSet<>();
		for (Rec r : sources.records(c.ownerId(), date, date)) {
			if (r.taskId() != null) {
				recorded.add(r.taskId());
			}
		}
		List<CarryOver> result = new ArrayList<>();
		for (TaskInfo t : sources.openTasks(c.ownerId())) {
			boolean due = t.dueDate() != null && !t.dueDate().isAfter(nextWorkday);
			if (recorded.contains(t.id()) || due || "IN_PROGRESS".equals(t.status())) {
				result.add(new CarryOver(t.id(), t.title(), t.status(), t.dueDate(), t.progress(), t.projectId(), true));
			}
		}
		result.sort(Comparator.comparing(CarryOver::dueDate, Comparator.nullsLast(Comparator.naturalOrder()))
			.thenComparing(CarryOver::title).thenComparing(CarryOver::taskId));
		return result;
	}

	/** 마감 뒤 제안 (LOG-16): 근무일이고 그 주·그 달의 마지막 근무일일 때 주간 → 월간. */
	private List<Suggestion> suggestions(Context c, LocalDate date) {
		WorkCalendar cal = c.calendar();
		List<Suggestion> result = new ArrayList<>();
		if (!cal.workday(date)) {
			return result;
		}
		LocalDate week = cal.weekStartOf(date);
		if (date.equals(cal.lastWorkday(week, LogType.WEEKLY.end(week)))) {
			result.add(suggestion(c, LogType.WEEKLY, week));
		}
		LocalDate month = date.withDayOfMonth(1);
		if (date.equals(cal.lastWorkday(month, LogType.MONTHLY.end(month)))) {
			result.add(suggestion(c, LogType.MONTHLY, month));
		}
		return result;
	}

	private Suggestion suggestion(Context c, LogType type, LocalDate start) {
		LocalDate end = type.end(start);
		return new Suggestion(type.name(), start, end, periods.period(c, type, start).status(),
				periods.unconfirmedWorkdays(c, start, end));
	}

	/** 내 것이고 보관하지 않은 업무의 제목. 없는 id는 빠진다. */
	private Map<UUID, String> activeTaskTitles(UUID ownerId, List<UUID> ids) {
		Map<UUID, String> found = new HashMap<>();
		if (ids.isEmpty()) {
			return found;
		}
		jdbc.sql("SELECT id, title FROM task WHERE owner_id = :owner AND deleted_at IS NULL AND id IN (:ids)")
			.param("owner", ownerId).param("ids", new LinkedHashSet<>(ids))
			.query((rs, i) -> found.put(rs.getObject("id", UUID.class), rs.getString("title")))
			.list();
		return found;
	}
}

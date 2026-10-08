package com.erp.worklog.journal;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import com.erp.worklog.journal.LogBuilder.Context;
import com.erp.worklog.journal.LogBuilder.Draft;
import com.erp.worklog.journal.LogViews.Achievement;
import com.erp.worklog.journal.LogViews.Content;
import com.erp.worklog.journal.LogViews.Plan;
import com.erp.worklog.journal.LogViews.Revision;
import com.erp.worklog.journal.LogViews.RevisionDetail;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.journal.WorkLogRepository.Row;
import com.erp.worklog.setting.SettingsService;
import com.erp.worklog.user.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 업무일지 (P3-02 도메인·확정·이력 LOG-05·06, P3-03 일간 생성 LOG-01~04). 요청 하나가 한 트랜잭션이다.
 * 초안의 content는 사용자가 고친 칸(Draft)만, 확정의 content는 그때 보인 LogContent 전체(스냅샷)다.
 */
@Service
class WorkLogService {

	private static final Set<String> OUTCOMES = Set.of("DONE", "REVIEW_REQUESTED", "IN_PROGRESS");
	private static final Set<String> SOURCES = Set.of("RECORD", "TASK", "MANUAL");

	/** null은 보내지 않은 칸. issues는 issuesSent로 비우기를 가린다. */
	record Change(long version, List<Achievement> achievements, List<Plan> plans, boolean issuesSent, String issues) {
	}

	private final WorkLogRepository logs;
	private final LogBuilder builder;
	private final LogSources sources;
	private final SettingsService settings;
	private final Holidays holidays;
	private final JsonMapper json;
	private final Clock clock;

	WorkLogService(WorkLogRepository logs, LogBuilder builder, LogSources sources, SettingsService settings,
			Holidays holidays, JsonMapper json, Clock clock) {
		this.logs = logs;
		this.builder = builder;
		this.sources = sources;
		this.settings = settings;
		this.holidays = holidays;
		this.json = json;
		this.clock = clock;
	}

	Context context(UUID ownerId, Profile profile) {
		ZoneId zone = ZoneId.of(profile.timezone());
		return new Context(ownerId, profile, zone, WorkCalendar.of(profile, holidays),
				settings.get(ownerId).timeTrackingEnabled(), LocalDate.ofInstant(clock.instant(), zone));
	}

	/** 저장된 일지, 없으면 저장하지 않은 미리보기. */
	@Transactional(readOnly = true)
	WorkLogView get(UUID ownerId, Profile profile, String typePath, LocalDate periodStart) {
		Context c = context(ownerId, profile);
		LogType type = LogType.ofPath(typePath);
		type.checkStart(periodStart, c.calendar());
		return logs.find(ownerId, type, periodStart).map(r -> view(c, r)).orElseGet(() -> preview(c, type, periodStart));
	}

	record Created(WorkLogView log, boolean created) {
	}

	/** 초안 만들기. 이미 있으면 있는 일지 (멱등). 오늘보다 뒤에 시작하는 기간은 400. */
	@Transactional
	Created create(UUID ownerId, Profile profile, String typePath, LocalDate periodStart) {
		Context c = context(ownerId, profile);
		LogType type = LogType.ofPath(typePath);
		type.checkStart(periodStart, c.calendar());
		if (periodStart.isAfter(c.today())) {
			throw Errors.invalid("periodStart", "OUT_OF_RANGE", null);
		}
		boolean created = logs.insertDraft(uuidV7(clock.instant()), ownerId, type, periodStart, type.end(periodStart),
				write(Draft.EMPTY), clock.instant());
		return new Created(view(c, logs.find(ownerId, type, periodStart).orElseThrow()), created);
	}

	/** 초안 고치기 (자동 저장). 바뀐 칸이 없으면 version을 그대로 둔다. */
	@Transactional
	WorkLogView patch(UUID ownerId, Profile profile, UUID id, Change change) {
		Context c = context(ownerId, profile);
		Row row = editable(ownerId, id, change.version());
		Draft before = read(row.content(), Draft.class);
		List<FieldErrorDetail> errors = new ArrayList<>();
		List<Achievement> achievements = change.achievements() == null ? before.achievements()
				: checkAchievements(change.achievements(), errors);
		List<Plan> plans = change.plans() == null ? before.plans() : checkPlans(change.plans(), errors);
		String issues = before.issues();
		if (change.issuesSent()) {
			issues = change.issues() == null || change.issues().isBlank() ? null : change.issues().strip();
		}
		throwIfAny(errors);
		Draft after = new Draft(achievements, plans, issues);
		if (after.equals(before)) {
			return view(c, row);
		}
		return save(c, row, false, write(after), null);
	}

	/** 원본에서 다시 채우기: 실적만 자동 상태로. 계획·이슈는 그대로. */
	@Transactional
	WorkLogView refill(UUID ownerId, Profile profile, UUID id, long version) {
		Context c = context(ownerId, profile);
		Row row = editable(ownerId, id, version);
		Draft d = read(row.content(), Draft.class);
		return save(c, row, false, write(new Draft(null, d.plans(), d.issues())), null);
	}

	/** 확정: 지금 보이는 내용 전체를 스냅샷으로 저장하고 이력에 한 줄을 더한다. */
	@Transactional
	WorkLogView confirm(UUID ownerId, Profile profile, UUID id, long version) {
		Context c = context(ownerId, profile);
		Row row = editable(ownerId, id, version);
		Content snapshot = builder.build(c, row.type(), row.periodStart(), read(row.content(), Draft.class)).asConfirmed();
		String content = write(snapshot);
		Instant now = clock.instant();
		WorkLogView saved = save(c, row, true, content, now);
		logs.addRevision(row.id(), content, now);
		return saved;
	}

	/** 확정 해제: 확정본 그대로 초안이 된다(실적은 고정, 자동 아님). 확정본은 이력에 남는다. */
	@Transactional
	WorkLogView unconfirm(UUID ownerId, Profile profile, UUID id, long version) {
		Context c = context(ownerId, profile);
		Row row = logs.findForUpdate(ownerId, id).orElseThrow(Errors::notFound);
		if (!row.confirmed()) {
			throw new ApiException(HttpStatus.CONFLICT, "LOG_NOT_CONFIRMED", "이미 초안이에요.");
		}
		if (row.version() != version) {
			throw Conflicts.versionConflict();
		}
		Content snapshot = read(row.content(), Content.class);
		Instant now = clock.instant();
		WorkLogView saved = save(c, row, false,
				write(new Draft(snapshot.achievements(), snapshot.plans(), snapshot.issues())), null);
		logs.markUnconfirmed(row.id(), now);
		return saved;
	}

	@Transactional(readOnly = true)
	List<Revision> revisions(UUID ownerId, UUID id) {
		logs.findById(ownerId, id).orElseThrow(Errors::notFound);
		return logs.revisions(id);
	}

	@Transactional(readOnly = true)
	RevisionDetail revision(UUID ownerId, UUID id, int revisionNo) {
		logs.findById(ownerId, id).orElseThrow(Errors::notFound);
		WorkLogRepository.RevisionRow r = logs.revision(id, revisionNo).orElseThrow(Errors::notFound);
		return new RevisionDetail(r.revision(), read(r.content(), Content.class));
	}

	/** 일지 화면 모양. 확정은 스냅샷, 초안은 고친 칸 + 원본. */
	WorkLogView view(Context c, Row row) {
		if (row.confirmed()) {
			Content snapshot = read(row.content(), Content.class);
			List<UUID> taskIds = snapshot.achievements().stream().map(Achievement::taskId).filter(Objects::nonNull).toList();
			boolean changed = sources.changedSince(c.ownerId(), c.zone(), row.periodStart(), row.periodEnd(),
					row.confirmedAt(), taskIds);
			return new WorkLogView(row.id(), row.type().name(), row.periodStart(), row.periodEnd(), "CONFIRMED",
					row.version(), row.confirmedAt(), changed, snapshot, List.of());
		}
		Content content = builder.build(c, row.type(), row.periodStart(), read(row.content(), Draft.class));
		return new WorkLogView(row.id(), row.type().name(), row.periodStart(), row.periodEnd(), "DRAFT", row.version(),
				null, false, content, builder.candidates(c, content.planPeriod()));
	}

	/** 저장하지 않은 미리보기 (id=null, version=0). */
	WorkLogView preview(Context c, LogType type, LocalDate start) {
		LocalDate end = type.end(start);
		Content content = builder.build(c, type, start, Draft.EMPTY);
		String status = sources.sourceDates(c.ownerId(), c.zone(), start, end).isEmpty() ? "NO_RECORDS" : "NOT_WRITTEN";
		return new WorkLogView(null, type.name(), start, end, status, 0, null, false, content,
				builder.candidates(c, content.planPeriod()));
	}

	/** 고칠 수 있는 초안: 없으면 404, 확정이면 409 LOG_CONFIRMED, version이 다르면 409. */
	private Row editable(UUID ownerId, UUID id, long version) {
		Row row = logs.findForUpdate(ownerId, id).orElseThrow(Errors::notFound);
		if (row.confirmed()) {
			throw new ApiException(HttpStatus.CONFLICT, "LOG_CONFIRMED", "확정한 일지는 고칠 수 없어요. 확정을 해제한 뒤 고쳐 주세요.");
		}
		if (row.version() != version) {
			throw Conflicts.versionConflict();
		}
		return row;
	}

	private WorkLogView save(Context c, Row row, boolean confirmed, String content, Instant confirmedAt) {
		if (!logs.update(row.id(), row.version(), confirmed, content, confirmedAt, clock.instant())) {
			throw Conflicts.versionConflict();
		}
		return view(c, logs.findById(c.ownerId(), row.id()).orElseThrow());
	}

	/** 실적 줄 검사: 내용 필수(앞뒤 공백 제거), 결과 칩·진행률 규칙은 기록과 같다. 서버 칸은 비워 두고 LogBuilder가 채운다. */
	private static List<Achievement> checkAchievements(List<Achievement> rows, List<FieldErrorDetail> errors) {
		List<Achievement> result = new ArrayList<>();
		for (int i = 0; i < rows.size(); i++) {
			Achievement a = rows.get(i);
			String at = "achievements[" + i + "].";
			if (a == null) {
				errors.add(error("achievements[" + i + "]", "REQUIRED"));
				continue;
			}
			if (a.id() == null) {
				errors.add(error(at + "id", "REQUIRED"));
			}
			String text = a.text() == null ? "" : a.text().strip();
			if (text.isEmpty()) {
				errors.add(error(at + "text", "REQUIRED"));
			}
			else if (text.length() > 500) {
				errors.add(error(at + "text", "TOO_LONG"));
			}
			String resultText = a.result() == null || a.result().isBlank() ? null : a.result().strip();
			if (resultText != null && resultText.length() > 200) {
				errors.add(error(at + "result", "TOO_LONG"));
			}
			if (a.outcome() != null && !OUTCOMES.contains(a.outcome())) {
				errors.add(error(at + "outcome", "INVALID_FORMAT"));
			}
			if (a.progress() != null) {
				if (!"IN_PROGRESS".equals(a.outcome())) {
					errors.add(error(at + "progress", "INVALID_FORMAT"));
				}
				else if (a.progress() < 0 || a.progress() > 100 || a.progress() % 10 != 0) {
					errors.add(error(at + "progress", "OUT_OF_RANGE"));
				}
			}
			String source = a.source() == null ? "MANUAL" : a.source();
			if (!SOURCES.contains(source)) {
				errors.add(error(at + "source", "INVALID_FORMAT"));
			}
			List<UUID> recordIds = a.recordIds() == null ? List.of() : a.recordIds().stream().filter(Objects::nonNull).distinct().toList();
			List<LocalDate> dates = a.dates() == null ? List.of() : a.dates().stream().filter(Objects::nonNull).distinct().sorted().toList();
			result.add(new Achievement(a.id(), text, resultText, a.outcome(), a.progress(), a.taskId(), null, dates,
					recordIds, null, source));
		}
		return result;
	}

	private static List<Plan> checkPlans(List<Plan> rows, List<FieldErrorDetail> errors) {
		List<Plan> result = new ArrayList<>();
		for (int i = 0; i < rows.size(); i++) {
			Plan p = rows.get(i);
			String at = "plans[" + i + "].";
			if (p == null) {
				errors.add(error("plans[" + i + "]", "REQUIRED"));
				continue;
			}
			if (p.id() == null) {
				errors.add(error(at + "id", "REQUIRED"));
			}
			String text = p.text() == null ? "" : p.text().strip();
			if (text.isEmpty()) {
				errors.add(error(at + "text", "REQUIRED"));
			}
			else if (text.length() > 200) {
				errors.add(error(at + "text", "TOO_LONG"));
			}
			result.add(new Plan(p.id(), text, p.taskId(), null, null));
		}
		return result;
	}

	String write(Object value) {
		return json.writeValueAsString(value);
	}

	<T> T read(String value, Class<T> type) {
		return json.readValue(value, type);
	}

	/** JPA 밖에서 넣는 행의 id. 앞 48비트가 만든 밀리초인 UUIDv7 (RFC 9562). */
	static UUID uuidV7(Instant now) {
		ThreadLocalRandom random = ThreadLocalRandom.current();
		long high = (now.toEpochMilli() << 16) | 0x7000L | (random.nextLong() & 0xFFFL);
		long low = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | Long.MIN_VALUE;
		return new UUID(high, low);
	}

	static FieldErrorDetail error(String field, String code) {
		return new FieldErrorDetail(field, code, null);
	}

	static void throwIfAny(List<FieldErrorDetail> errors) {
		if (!errors.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.", errors,
					Map.of());
		}
	}
}

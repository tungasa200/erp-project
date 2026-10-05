package com.erp.worklog.schedule;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.UuidGenerator;

/**
 * 일정 (SCH-02)과 반복 (SCH-03). 시간 일정은 startAt·endAt, 종일 일정은 startDate·endDate(포함)를 쓴다.
 * 반복 회차는 일정 시간대(timezone)의 같은 벽시계 시각이다(D-40). 회차 키는 원래 회차의 시작 시각이며,
 * 종일 일정은 원래 날짜의 일정 시간대 0시다.
 */
@Entity
@Table(name = "schedule")
class Schedule {

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;

	private UUID ownerId;

	private UUID taskId;

	private String title;

	private boolean allDay;

	private Instant startAt;

	private Instant endAt;

	private LocalDate startDate;

	private LocalDate endDate;

	private String timezone;

	@Column(name = "recurrence_rule")
	private String recurrenceRule;

	private String memo;

	private Instant spanStart;

	private Instant spanEnd;

	/** 회차별 변경. 바꾸면 일정의 version도 오른다(소유한 컬렉션 변경). */
	@ElementCollection
	@CollectionTable(name = "schedule_exception", joinColumns = @JoinColumn(name = "schedule_id"))
	@MapKeyColumn(name = "occurrence_start")
	private Map<Instant, ScheduleOverride> exceptions = new HashMap<>();

	@Version
	private Long version;

	private Instant createdAt;

	private Instant updatedAt;

	protected Schedule() {
	}

	Schedule(UUID ownerId, String timezone, Instant now) {
		this.ownerId = ownerId;
		this.timezone = timezone;
		this.createdAt = now;
		this.updatedAt = now;
	}

	/** 시간 칸 한 묶음. allDay에 맞는 두 칸만 값이 있다. */
	record Timing(boolean allDay, Instant startAt, Instant endAt, LocalDate startDate, LocalDate endDate) {
	}

	/** 화면에 그리는 회차 하나. */
	record Occurrence(Instant key, boolean recurring, boolean modified, String title, boolean allDay, Instant startAt,
			Instant endAt, LocalDate startDate, LocalDate endDate, String memo) {
	}

	// ── 바꾸기

	void title(String title) {
		this.title = title;
	}

	void memo(String memo) {
		this.memo = memo;
	}

	void taskId(UUID taskId) {
		this.taskId = taskId;
	}

	/** 시각·반복을 바꾼다. 반복 일정에서 둘 중 하나라도 바뀌면 회차별 변경을 모두 지운다(회차 키가 달라지므로). */
	void timing(Timing timing, Recurrence recurrence) {
		String rule = recurrence == null ? null : recurrence.toRrule();
		boolean changed = !timing.equals(timing()) || !java.util.Objects.equals(rule, recurrenceRule);
		if (changed && recurrenceRule != null) {
			exceptions.clear();
		}
		this.allDay = timing.allDay();
		this.startAt = timing.startAt();
		this.endAt = timing.endAt();
		this.startDate = timing.startDate();
		this.endDate = timing.endDate();
		this.recurrenceRule = rule;
	}

	void override(Instant key, ScheduleOverride override) {
		exceptions.put(key, override);
	}

	/** 변경 뒤 기간 조회용 전체 구간을 다시 계산하고 수정 시각을 남긴다. */
	void touch(Instant now) {
		this.updatedAt = now;
		recomputeSpan();
	}

	// ── 읽기

	Timing timing() {
		return new Timing(allDay, startAt, endAt, startDate, endDate);
	}

	Recurrence recurrence() {
		return recurrenceRule == null ? null : Recurrence.parse(recurrenceRule);
	}

	boolean recurring() {
		return recurrenceRule != null;
	}

	ScheduleOverride overrideOf(Instant key) {
		return exceptions.get(key);
	}

	/** key가 이 일정의 (취소하지 않은) 회차인지. */
	boolean hasOccurrence(Instant key) {
		ScheduleOverride o = exceptions.get(key);
		if (o != null && o.cancelled()) {
			return false;
		}
		Iterator<LocalDate> dates = dates();
		while (dates.hasNext()) {
			Instant candidate = keyOf(dates.next());
			if (candidate.equals(key)) {
				return true;
			}
			if (candidate.isAfter(key)) {
				return false;
			}
		}
		return false;
	}

	/** [from, to)와 겹치는 회차를 시작순으로. 옮긴 회차는 옮긴 시각으로 판단한다. */
	List<Occurrence> occurrences(Instant from, Instant to) {
		List<Occurrence> result = new ArrayList<>();
		Iterator<LocalDate> dates = dates();
		while (dates.hasNext()) {
			Instant key = keyOf(dates.next());
			if (!key.isBefore(to) && !hasMovedOccurrenceAfter(key)) {
				break; // 이후 회차는 모두 범위 뒤. 범위 앞으로 옮긴 회차가 남아 있으면 계속 본다
			}
			Occurrence occurrence = occurrence(key);
			if (occurrence != null && overlaps(occurrence, from, to)) {
				result.add(occurrence);
			}
		}
		result.sort((a, b) -> startInstant(a).compareTo(startInstant(b)));
		return result;
	}

	/** 키의 회차를 변경까지 적용해 만든다. 취소한 회차면 null. */
	Occurrence occurrence(Instant key) {
		ScheduleOverride o = exceptions.get(key);
		if (o != null && o.cancelled()) {
			return null;
		}
		ZoneId zone = zone();
		String occurrenceTitle = o != null && o.title() != null ? o.title() : title;
		String occurrenceMemo = o != null && o.memoOverridden() ? o.memo() : memo;
		boolean modified = o != null;
		if (allDay) {
			LocalDate date = LocalDate.ofInstant(key, zone);
			LocalDate start = o != null && o.startDate() != null ? o.startDate() : date;
			LocalDate end = o != null && o.endDate() != null ? o.endDate()
					: date.plusDays(ChronoUnit.DAYS.between(startDate, endDate));
			return new Occurrence(key, recurring(), modified, occurrenceTitle, true, null, null, start, end,
					occurrenceMemo);
		}
		Instant start = o != null && o.startAt() != null ? o.startAt() : key;
		Instant end = o != null && o.endAt() != null ? o.endAt() : key.plus(Duration.between(startAt, endAt));
		return new Occurrence(key, recurring(), modified, occurrenceTitle, false, start, end, null, null,
				occurrenceMemo);
	}

	private boolean hasMovedOccurrenceAfter(Instant key) {
		return exceptions.entrySet()
			.stream()
			.anyMatch(e -> !e.getKey().isBefore(key) && !e.getValue().cancelled()
					&& (e.getValue().startAt() != null || e.getValue().startDate() != null));
	}

	private boolean overlaps(Occurrence o, Instant from, Instant to) {
		return startInstant(o).isBefore(to) && endInstant(o).isAfter(from);
	}

	private Instant startInstant(Occurrence o) {
		return o.allDay() ? o.startDate().atStartOfDay(zone()).toInstant() : o.startAt();
	}

	private Instant endInstant(Occurrence o) {
		return o.allDay() ? o.endDate().plusDays(1).atStartOfDay(zone()).toInstant() : o.endAt();
	}

	/** 반복이 없으면 시작일 하나. */
	private Iterator<LocalDate> dates() {
		LocalDate first = allDay ? startDate : LocalDate.ofInstant(startAt, zone());
		Recurrence recurrence = recurrence();
		return recurrence == null ? List.of(first).iterator() : recurrence.dates(first);
	}

	/** 그 날짜 회차의 키: 시간 일정은 일정 시간대에서 같은 벽시계 시각, 종일은 그날 0시. */
	Instant keyOf(LocalDate date) {
		ZoneId zone = zone();
		if (allDay) {
			return date.atStartOfDay(zone).toInstant();
		}
		LocalDateTime local = LocalDateTime.ofInstant(startAt, zone);
		return date.atTime(local.toLocalTime()).atZone(zone).toInstant();
	}

	/** 첫 회차 시작 ~ 마지막 회차 끝. 끝없는 반복이면 끝은 null. 옮긴 회차까지 포함한다. */
	private void recomputeSpan() {
		Occurrence first = occurrence(keyOf(allDay ? startDate : LocalDate.ofInstant(startAt, zone())));
		Instant start = first != null ? startInstant(first) : keyOf(allDay ? startDate : LocalDate.ofInstant(startAt, zone()));
		Instant end = null;
		Recurrence recurrence = recurrence();
		boolean finite = recurrence == null || recurrence.count() != null || recurrence.until() != null;
		if (finite) {
			Iterator<LocalDate> dates = dates();
			while (dates.hasNext()) {
				Occurrence o = occurrence(keyOf(dates.next()));
				if (o == null) {
					continue;
				}
				Instant oStart = startInstant(o);
				Instant oEnd = endInstant(o);
				start = oStart.isBefore(start) ? oStart : start;
				end = end == null || oEnd.isAfter(end) ? oEnd : end;
			}
			if (end == null) { // 모든 회차를 취소함
				end = start;
			}
		}
		else {
			for (Map.Entry<Instant, ScheduleOverride> e : exceptions.entrySet()) {
				Occurrence o = occurrence(e.getKey());
				if (o != null && startInstant(o).isBefore(start)) {
					start = startInstant(o);
				}
			}
		}
		this.spanStart = start;
		this.spanEnd = end;
	}

	private ZoneId zone() {
		return ZoneId.of(timezone);
	}

	UUID getId() {
		return id;
	}

	UUID getOwnerId() {
		return ownerId;
	}

	UUID getTaskId() {
		return taskId;
	}

	String getTitle() {
		return title;
	}

	String getTimezone() {
		return timezone;
	}

	String getMemo() {
		return memo;
	}

	Long getVersion() {
		return version;
	}

	Instant getCreatedAt() {
		return createdAt;
	}

	Instant getUpdatedAt() {
		return updatedAt;
	}

}

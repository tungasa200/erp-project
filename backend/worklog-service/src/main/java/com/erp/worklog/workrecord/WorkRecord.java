package com.erp.worklog.workrecord;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 업무 기록 (REC-01·02). 계획(일정 회차)에서 온 기록은 occurrenceStart가 있고 세 상태를 오가며, 직접 쓴 기록은 CONFIRMED뿐이다.
 * 삭제는 보관(deletedAt)이며, 보관한 기록은 복원 전까지 고칠 수 없다.
 */
@Entity
@Table(name = "work_record")
class WorkRecord {

	enum Status {
		PENDING, CONFIRMED, DISMISSED
	}

	enum Outcome {
		DONE, REVIEW_REQUESTED, IN_PROGRESS
	}

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;
	private UUID ownerId;
	private UUID workspaceId;
	private UUID taskId;
	private UUID scheduleId;
	private Instant occurrenceStart;
	@Enumerated(EnumType.STRING)
	private Status status;
	private LocalDate workDate;
	private String content;
	private String result;
	@Enumerated(EnumType.STRING)
	private Outcome outcome;
	private Short progress;
	private Instant startAt;
	private Instant endAt;
	private Integer durationMin;
	private Instant deletedAt;
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected WorkRecord() {
	}

	/** 직접 쓴 기록. 바로 확정이다. */
	WorkRecord(UUID ownerId, Instant now) {
		this.ownerId = ownerId;
		this.status = Status.CONFIRMED;
		this.createdAt = now;
		this.updatedAt = now;
	}

	/** 타이머가 계획 회차를 가져간 기록 (P2-06 이어달리기). 만들 때 한 번만 정한다. */
	void plan(UUID scheduleId, Instant occurrenceStart) {
		this.scheduleId = scheduleId;
		this.occurrenceStart = occurrenceStart;
	}

	void status(Status status) {
		this.status = status;
	}

	void workDate(LocalDate workDate) {
		this.workDate = workDate;
	}

	void content(String content) {
		this.content = content;
	}

	void taskId(UUID taskId) {
		this.taskId = taskId;
	}

	void result(String result, Outcome outcome, Integer progress) {
		this.result = result;
		this.outcome = outcome;
		this.progress = progress == null ? null : progress.shortValue();
	}

	void time(Instant startAt, Instant endAt, Integer durationMin) {
		this.startAt = startAt;
		this.endAt = endAt;
		this.durationMin = durationMin;
	}

	void delete(Instant now) {
		if (deletedAt == null) {
			deletedAt = now;
			updatedAt = now;
		}
	}

	void restore(Instant now) {
		if (deletedAt != null) {
			deletedAt = null;
			updatedAt = now;
		}
	}

	void touch(Instant now) {
		this.updatedAt = now;
	}

	/** 계획(일정 회차)에서 온 기록인지. 일정을 지워도 회차 키는 남는다. */
	boolean fromPlan() {
		return occurrenceStart != null;
	}

	/** 실행 중인 타이머 모양인지 (시작만 있고 끝·소요시간이 없다, V7 work_record_one_running). 보관 여부는 따로 본다. */
	boolean running() {
		return startAt != null && endAt == null && durationMin == null;
	}

	UUID id() {
		return id;
	}

	UUID taskId() {
		return taskId;
	}

	UUID scheduleId() {
		return scheduleId;
	}

	Instant occurrenceStart() {
		return occurrenceStart;
	}

	Status status() {
		return status;
	}

	LocalDate workDate() {
		return workDate;
	}

	String content() {
		return content;
	}

	String result() {
		return result;
	}

	Outcome outcome() {
		return outcome;
	}

	Integer progress() {
		return progress == null ? null : progress.intValue();
	}

	Instant startAt() {
		return startAt;
	}

	Instant endAt() {
		return endAt;
	}

	Integer durationMin() {
		return durationMin;
	}

	Instant deletedAt() {
		return deletedAt;
	}

	long version() {
		return version;
	}

	Instant createdAt() {
		return createdAt;
	}

	Instant updatedAt() {
		return updatedAt;
	}
}

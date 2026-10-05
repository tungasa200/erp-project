package com.erp.worklog.task;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** 업무 (TASK-01·02·03·05). 삭제는 보관(deletedAt)이며, 보관한 업무는 복원 전까지 고칠 수 없다. */
@Entity
@Table(name = "task")
class Task {

	enum Status {
		TODO, IN_PROGRESS, DONE, ON_HOLD
	}

	enum Priority {
		HIGH, NORMAL, LOW
	}

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;
	private UUID ownerId;
	private UUID projectId;
	private String title;
	@Enumerated(EnumType.STRING)
	private Status status;
	@Enumerated(EnumType.STRING)
	private Priority priority;
	private LocalDate dueDate;
	private short progress;
	private Instant completedAt;
	private String memo;
	@Column(name = "carried_over_from")
	private UUID carriedOverFromId;
	private Instant deletedAt;
	/** 태그 목록을 바꿔도 version이 오른다 (Hibernate는 소유한 컬렉션 변경을 엔티티 변경으로 본다). */
	@ElementCollection
	@CollectionTable(name = "task_tag", joinColumns = @JoinColumn(name = "task_id"))
	@Column(name = "tag_id")
	private Set<UUID> tagIds = new HashSet<>();
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected Task() {
	}

	Task(UUID ownerId, String title, Instant now) {
		this.ownerId = ownerId;
		this.title = title;
		this.status = Status.TODO;
		this.priority = Priority.NORMAL;
		this.createdAt = now;
		this.updatedAt = now;
	}

	void title(String title) {
		this.title = title;
	}

	/** DONE이 되면 완료 시각을 기록하고, DONE에서 벗어나면 지운다 (TASK-02). 전이 제한은 없다. */
	void status(Status status, Instant now) {
		if (status == this.status) {
			return;
		}
		this.status = status;
		this.completedAt = status == Status.DONE ? now : null;
	}

	void priority(Priority priority) {
		this.priority = priority;
	}

	void dueDate(LocalDate dueDate) {
		this.dueDate = dueDate;
	}

	void progress(int progress) {
		this.progress = (short) progress;
	}

	void projectId(UUID projectId) {
		this.projectId = projectId;
	}

	void memo(String memo) {
		this.memo = memo;
	}

	void tagIds(Set<UUID> tagIds) {
		if (!this.tagIds.equals(tagIds)) {
			this.tagIds.clear();
			this.tagIds.addAll(tagIds);
		}
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

	UUID id() {
		return id;
	}

	UUID ownerId() {
		return ownerId;
	}

	UUID projectId() {
		return projectId;
	}

	String title() {
		return title;
	}

	Status status() {
		return status;
	}

	Priority priority() {
		return priority;
	}

	LocalDate dueDate() {
		return dueDate;
	}

	int progress() {
		return progress;
	}

	Instant completedAt() {
		return completedAt;
	}

	String memo() {
		return memo;
	}

	UUID carriedOverFromId() {
		return carriedOverFromId;
	}

	Instant deletedAt() {
		return deletedAt;
	}

	Set<UUID> tagIds() {
		return tagIds;
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

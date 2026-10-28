package com.erp.worklog.project;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * 프로젝트 (TASK-04, SCR-SET-08). 삭제 없이 보관만 한다.
 * 순서 저장(ProjectService.reorder)이 version 없이 SQL로 position을 바꾸므로, 엔티티 저장은 바뀐 칸만 쓴다(옛 position을 덮어쓰지 않게).
 */
@DynamicUpdate
@Entity
@Table(name = "project")
class Project {

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;
	private UUID ownerId;
	private String name;
	private String color;
	private int position;
	private Instant archivedAt;
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected Project() {
	}

	Project(UUID ownerId, String name, String color, int position, Instant now) {
		this.ownerId = ownerId;
		this.name = name;
		this.color = color;
		this.position = position;
		this.createdAt = now;
		this.updatedAt = now;
	}

	void update(String name, String color, Boolean archived, Instant now) {
		boolean changed = false;
		if (name != null && !name.equals(this.name)) {
			this.name = name;
			changed = true;
		}
		if (color != null && !color.equals(this.color)) {
			this.color = color;
			changed = true;
		}
		if (archived != null && archived != (archivedAt != null)) {
			this.archivedAt = archived ? now : null;
			changed = true;
		}
		if (changed) {
			this.updatedAt = now;
		}
	}

	/** 맨 아래로 옮긴다(보관 해제). */
	void moveTo(int position) {
		this.position = position;
	}

	UUID id() {
		return id;
	}

	String name() {
		return name;
	}

	String color() {
		return color;
	}

	int position() {
		return position;
	}

	Instant archivedAt() {
		return archivedAt;
	}

	long version() {
		return version;
	}

	Instant createdAt() {
		return createdAt;
	}
}

package com.erp.worklog.project;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/** 프로젝트 (TASK-04, SCR-SET-08). 삭제 없이 보관만 한다. */
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
	private Instant archivedAt;
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected Project() {
	}

	Project(UUID ownerId, String name, String color, Instant now) {
		this.ownerId = ownerId;
		this.name = name;
		this.color = color;
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

	UUID id() {
		return id;
	}

	String name() {
		return name;
	}

	String color() {
		return color;
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

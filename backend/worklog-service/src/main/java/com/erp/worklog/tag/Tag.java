package com.erp.worklog.tag;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/** 태그 (TASK-04, SCR-SET-08). 삭제하면 실제로 지우고 업무에서도 뗀다 (task_tag ON DELETE CASCADE). */
@Entity
@Table(name = "tag")
class Tag {

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;
	private UUID ownerId;
	private String name;
	@Version
	private Long version;
	private Instant createdAt;
	private Instant updatedAt;

	protected Tag() {
	}

	Tag(UUID ownerId, String name, Instant now) {
		this.ownerId = ownerId;
		this.name = name;
		this.createdAt = now;
		this.updatedAt = now;
	}

	void rename(String name, Instant now) {
		if (!name.equals(this.name)) {
			this.name = name;
			this.updatedAt = now;
		}
	}

	UUID id() {
		return id;
	}

	String name() {
		return name;
	}

	long version() {
		return version;
	}

	Instant createdAt() {
		return createdAt;
	}
}

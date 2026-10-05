package com.erp.worklog.task;

import com.fasterxml.jackson.annotation.JsonSetter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * PATCH /api/worklog/tasks/{id} 본문. 마감일·프로젝트·메모는 null을 보내면 비우고 보내지 않으면 그대로 두므로,
 * setter가 불렸는지(칸이 본문에 있었는지)를 따로 기록한다. 나머지 칸은 null이면 보내지 않은 것으로 본다.
 */
@Schema(name = "TaskPatch")
class TaskPatch {

	@Schema(requiredMode = RequiredMode.REQUIRED)
	@NotNull(message = "REQUIRED")
	private Long version;
	@Schema(minLength = 1, maxLength = 200)
	@Size(max = 200, message = "TOO_LONG")
	private String title;
	@Schema(allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" })
	@Pattern(regexp = TaskController.STATUS, message = "INVALID_FORMAT")
	private String status;
	@Schema(allowableValues = { "HIGH", "NORMAL", "LOW" })
	@Pattern(regexp = TaskController.PRIORITY, message = "INVALID_FORMAT")
	private String priority;
	@Schema(types = { "string", "null" }, format = "date")
	private LocalDate dueDate;
	private boolean dueDateSent;
	@Schema(minimum = "0", maximum = "100", multipleOf = 10)
	private Integer progress;
	@Schema(types = { "string", "null" }, format = "uuid")
	private UUID projectId;
	private boolean projectIdSent;
	private List<UUID> tagIds;
	@Schema(types = { "string", "null" }, maxLength = 5000)
	@Size(max = 5000, message = "TOO_LONG")
	private String memo;
	private boolean memoSent;

	public Long getVersion() {
		return version;
	}

	public void setVersion(Long version) {
		this.version = version;
	}

	public String getTitle() {
		return title;
	}

	public void setTitle(String title) {
		this.title = title;
	}

	public String getStatus() {
		return status;
	}

	public void setStatus(String status) {
		this.status = status;
	}

	public String getPriority() {
		return priority;
	}

	public void setPriority(String priority) {
		this.priority = priority;
	}

	public LocalDate getDueDate() {
		return dueDate;
	}

	@JsonSetter
	public void setDueDate(LocalDate dueDate) {
		this.dueDate = dueDate;
		this.dueDateSent = true;
	}

	public Integer getProgress() {
		return progress;
	}

	public void setProgress(Integer progress) {
		this.progress = progress;
	}

	public UUID getProjectId() {
		return projectId;
	}

	@JsonSetter
	public void setProjectId(UUID projectId) {
		this.projectId = projectId;
		this.projectIdSent = true;
	}

	public List<UUID> getTagIds() {
		return tagIds;
	}

	public void setTagIds(List<UUID> tagIds) {
		this.tagIds = tagIds;
	}

	public String getMemo() {
		return memo;
	}

	@JsonSetter
	public void setMemo(String memo) {
		this.memo = memo;
		this.memoSent = true;
	}

	TaskService.Change toChange() {
		return new TaskService.Change(version, title, status, priority, sent(dueDateSent, dueDate), progress,
				sent(projectIdSent, projectId), tagIds, sent(memoSent, memo));
	}

	/** 보내지 않았으면 null, null을 보냈으면 Optional.empty() */
	private static <T> Optional<T> sent(boolean sent, T value) {
		return sent ? Optional.ofNullable(value) : null;
	}
}

package com.erp.worklog.task;

import com.erp.common.error.ApiException;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** 업무 (P1-03). 목록 조회는 {@link TaskQueries}. */
@Service
public class TaskService {

	public record TaskInfo(UUID id, String title, String status, String priority, LocalDate dueDate, int progress,
			Instant completedAt, UUID projectId, List<UUID> tagIds, boolean hasSchedule, String memo, UUID carriedOverFromId,
			Instant deletedAt, Instant createdAt, Instant updatedAt, long version) {
	}

	public record NewTask(String title, String status, String priority, LocalDate dueDate, Integer progress,
			UUID projectId, List<UUID> tagIds, String memo) {
	}

	/** null은 보내지 않은 칸. nullable 칸의 Optional.empty()는 비우기. */
	public record Change(long version, String title, String status, String priority, Optional<LocalDate> dueDate,
			Integer progress, Optional<UUID> projectId, List<UUID> tagIds, Optional<String> memo) {
	}

	private final TaskRepository tasks;
	private final JdbcClient jdbc;
	private final Clock clock;

	TaskService(TaskRepository tasks, JdbcClient jdbc, Clock clock) {
		this.tasks = tasks;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public TaskInfo get(UUID ownerId, UUID id) {
		return info(find(ownerId, id));
	}

	@Transactional
	public TaskInfo create(UUID ownerId, NewTask n) {
		Instant now = clock.instant();
		Task task = new Task(ownerId, requireTitle(n.title()), now);
		if (n.status() != null) {
			task.status(Task.Status.valueOf(n.status()), now);
		}
		if (n.priority() != null) {
			task.priority(Task.Priority.valueOf(n.priority()));
		}
		task.dueDate(n.dueDate());
		task.progress(n.progress() == null ? 0 : requireProgress(n.progress()));
		task.projectId(requireProject(ownerId, n.projectId()));
		task.tagIds(requireTags(ownerId, n.tagIds()));
		task.memo(n.memo());
		return info(tasks.saveAndFlush(task));
	}

	@Transactional
	public TaskInfo update(UUID ownerId, UUID id, Change c) {
		Task task = find(ownerId, id);
		if (task.deletedAt() != null) {
			throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "보관한 업무예요. 복원한 뒤 고쳐 주세요.");
		}
		if (task.version() != c.version()) {
			throw Conflicts.versionConflict();
		}
		TaskInfo before = info(task);
		Instant now = clock.instant();
		if (c.title() != null) {
			task.title(requireTitle(c.title()));
		}
		if (c.status() != null) {
			task.status(Task.Status.valueOf(c.status()), now);
		}
		if (c.priority() != null) {
			task.priority(Task.Priority.valueOf(c.priority()));
		}
		if (c.dueDate() != null) {
			task.dueDate(c.dueDate().orElse(null));
		}
		if (c.progress() != null) {
			task.progress(requireProgress(c.progress()));
		}
		if (c.projectId() != null) {
			task.projectId(requireProject(ownerId, c.projectId().orElse(null)));
		}
		if (c.tagIds() != null) {
			task.tagIds(requireTags(ownerId, c.tagIds()));
		}
		if (c.memo() != null) {
			task.memo(c.memo().orElse(null));
		}
		// 바뀐 칸이 없으면 수정 시각·version을 그대로 둔다 (자동 저장이 같은 값을 다시 보내도 충돌을 만들지 않게)
		if (!info(task).equals(before)) {
			task.touch(now);
		}
		return info(tasks.saveAndFlush(task));
	}

	/** 보관. 이미 보관했으면 그대로 둔다 (멱등). version을 보지 않는다. */
	@Transactional
	public void delete(UUID ownerId, UUID id) {
		find(ownerId, id).delete(clock.instant());
	}

	@Transactional
	public TaskInfo restore(UUID ownerId, UUID id) {
		Task task = find(ownerId, id);
		task.restore(clock.instant());
		return info(tasks.saveAndFlush(task));
	}

	private Task find(UUID ownerId, UUID id) {
		return tasks.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
	}

	private static String requireTitle(String title) {
		String trimmed = title.strip();
		if (trimmed.isEmpty()) {
			throw Errors.invalid("title", "REQUIRED", "제목을 입력해 주세요.");
		}
		return trimmed;
	}

	private static int requireProgress(int progress) {
		if (progress < 0 || progress > 100 || progress % 10 != 0) {
			throw Errors.invalid("progress", "OUT_OF_RANGE", "진행률은 0~100 사이 10 단위예요.");
		}
		return progress;
	}

	/** 보관한 프로젝트도 고를 수 있다. 다른 사용자의 프로젝트는 없는 것과 같다. */
	private UUID requireProject(UUID ownerId, UUID projectId) {
		if (projectId != null && jdbc.sql("SELECT count(*) FROM project WHERE id = ? AND owner_id = ?")
				.params(projectId, ownerId).query(Long.class).single() == 0) {
			throw Errors.invalid("projectId", "NOT_FOUND", "프로젝트를 찾을 수 없어요.");
		}
		return projectId;
	}

	private Set<UUID> requireTags(UUID ownerId, Collection<UUID> tagIds) {
		Set<UUID> ids = tagIds == null ? Set.of() : new HashSet<>(tagIds);
		if (!ids.isEmpty() && jdbc.sql("SELECT count(*) FROM tag WHERE owner_id = :owner AND id IN (:ids)")
				.param("owner", ownerId).param("ids", ids).query(Long.class).single() != ids.size()) {
			throw Errors.invalid("tagIds", "NOT_FOUND", "태그를 찾을 수 없어요.");
		}
		return ids;
	}

	private TaskInfo info(Task t) {
		return new TaskInfo(t.id(), t.title(), t.status().name(), t.priority().name(), t.dueDate(), t.progress(),
				t.completedAt(), t.projectId(), t.tagIds().stream().sorted().toList(), hasSchedule(t.id()), t.memo(),
				t.carriedOverFromId(), t.deletedAt(), t.createdAt(), t.updatedAt(), t.version());
	}

	/** 일정이 업무에 연결돼 있는지 (반복 일정은 시리즈 하나로 센다). 목록은 TaskQueries가 같은 조건으로 한 번에 구한다. */
	private boolean hasSchedule(UUID taskId) {
		return jdbc.sql("SELECT EXISTS (SELECT 1 FROM schedule s WHERE s.task_id = ?)").param(taskId)
				.query(Boolean.class).single();
	}
}

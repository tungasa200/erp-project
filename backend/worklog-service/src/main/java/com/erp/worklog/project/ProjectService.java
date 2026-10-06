package com.erp.worklog.project;

import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 프로젝트 (P1-02). 업무 수는 보관하지 않은 업무만 센다. 남은 업무 수는 그중 완료(DONE)가 아닌 것 (사이드바, SCR-COM-01). */
@Service
public class ProjectService {

	public record ProjectInfo(UUID id, String name, String color, Instant archivedAt, long taskCount,
			long openTaskCount, Instant createdAt, long version) {
	}

	private record Counts(long all, long open) {
		static final Counts NONE = new Counts(0, 0);
	}

	public record Change(long version, String name, String color, Boolean archived) {
	}

	private final ProjectRepository projects;
	private final JdbcClient jdbc;
	private final Clock clock;

	ProjectService(ProjectRepository projects, JdbcClient jdbc, Clock clock) {
		this.projects = projects;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public List<ProjectInfo> list(UUID ownerId, boolean includeArchived) {
		List<Project> found = includeArchived ? projects.findByOwnerIdOrderByIdAsc(ownerId)
				: projects.findByOwnerIdAndArchivedAtIsNullOrderByIdAsc(ownerId);
		Map<UUID, Counts> counts = taskCounts(ownerId);
		return found.stream().map(p -> info(p, counts.getOrDefault(p.id(), Counts.NONE))).toList();
	}

	@Transactional(readOnly = true)
	public ProjectInfo get(UUID ownerId, UUID id) {
		Project p = projects.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
		return info(p, taskCounts(ownerId).getOrDefault(id, Counts.NONE));
	}

	@Transactional
	public ProjectInfo create(UUID ownerId, String name, String color) {
		String trimmed = requireName(name);
		if (!projects.findIdsByName(ownerId, trimmed).isEmpty()) {
			throw Errors.duplicateName();
		}
		return info(saveChecked(new Project(ownerId, trimmed, color, clock.instant())), Counts.NONE);
	}

	@Transactional
	public ProjectInfo update(UUID ownerId, UUID id, Change change) {
		Project p = projects.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
		if (p.version() != change.version()) {
			throw Conflicts.versionConflict();
		}
		String name = change.name() == null ? null : requireName(change.name());
		if (name != null && projects.findIdsByName(ownerId, name).stream().anyMatch(other -> !other.equals(id))) {
			throw Errors.duplicateName();
		}
		p.update(name, change.color(), change.archived(), clock.instant());
		return info(saveChecked(p), taskCounts(ownerId).getOrDefault(id, Counts.NONE));
	}

	/** 응답에 바뀐 version을 실으려고 바로 반영한다. 이름 확인과 저장 사이에 같은 이름이 들어오면 유니크 인덱스가 막는다. */
	private Project saveChecked(Project p) {
		try {
			return projects.saveAndFlush(p);
		} catch (DataIntegrityViolationException e) {
			throw Errors.duplicateName();
		}
	}

	private Map<UUID, Counts> taskCounts(UUID ownerId) {
		Map<UUID, Counts> counts = new HashMap<>();
		jdbc.sql("""
						SELECT project_id, count(*) AS n, count(*) FILTER (WHERE status <> 'DONE') AS open_n
						FROM task
						WHERE owner_id = ? AND deleted_at IS NULL AND project_id IS NOT NULL
						GROUP BY project_id""")
				.param(ownerId)
				.query((rs, i) -> counts.put(rs.getObject("project_id", UUID.class),
						new Counts(rs.getLong("n"), rs.getLong("open_n"))))
				.list();
		return counts;
	}

	private static String requireName(String name) {
		String trimmed = name.strip();
		if (trimmed.isEmpty()) {
			throw Errors.invalid("name", "REQUIRED", "이름을 입력해 주세요.");
		}
		return trimmed;
	}

	private static ProjectInfo info(Project p, Counts counts) {
		return new ProjectInfo(p.id(), p.name(), p.color(), p.archivedAt(), counts.all(), counts.open(), p.createdAt(),
				p.version());
	}
}

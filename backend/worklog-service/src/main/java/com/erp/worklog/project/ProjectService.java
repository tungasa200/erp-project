package com.erp.worklog.project;

import com.erp.common.error.ApiException;
import com.erp.worklog.error.Conflicts;
import com.erp.worklog.error.Errors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 프로젝트 (P1-02). 업무 수는 보관하지 않은 업무만 센다. 남은 업무 수는 그중 완료(DONE)가 아닌 것 (사이드바, SCR-COM-01). */
@Service
public class ProjectService {

	public record ProjectInfo(UUID id, String name, String color, int position, Instant archivedAt, long taskCount,
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
		List<Project> found = includeArchived ? projects.findAllOrdered(ownerId)
				: projects.findByOwnerIdAndArchivedAtIsNullOrderByPositionAscIdAsc(ownerId);
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
		lockOrder(ownerId);
		if (!projects.findIdsByName(ownerId, trimmed).isEmpty()) {
			throw Errors.duplicateName();
		}
		Project p = new Project(ownerId, trimmed, color, projects.nextPosition(ownerId), clock.instant());
		return info(saveChecked(p), Counts.NONE);
	}

	@Transactional
	public ProjectInfo update(UUID ownerId, UUID id, Change change) {
		if (change.archived() != null) {
			lockOrder(ownerId); // 보관·보관 해제는 순서 저장의 집합을 바꾼다. 이름·색은 position을 쓰지 않아(@DynamicUpdate) 잠그지 않는다.
		}
		Project p = projects.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
		if (p.version() != change.version()) {
			throw Conflicts.versionConflict();
		}
		String name = change.name() == null ? null : requireName(change.name());
		if (name != null && projects.findIdsByName(ownerId, name).stream().anyMatch(other -> !other.equals(id))) {
			throw Errors.duplicateName();
		}
		if (p.archivedAt() != null && Boolean.FALSE.equals(change.archived())) {
			p.moveTo(projects.nextPosition(ownerId)); // 보관 해제는 맨 아래로
		}
		p.update(name, change.color(), change.archived(), clock.instant());
		return info(saveChecked(p), taskCounts(ownerId).getOrDefault(id, Counts.NONE));
	}

	/**
	 * 보관하지 않은 프로젝트 전체의 새 순서를 저장한다(카드 20261028-0100). position을 1부터 다시 매긴다.
	 * 보낸 id 집합이 지금 보관하지 않은 프로젝트 집합과 다르면 409 PROJECT_ORDER_STALE. 집합이 같은 요청끼리는 나중 것이 이긴다.
	 * version·updatedAt은 올리지 않는다(다른 탭의 이름·색 PATCH가 409가 되지 않게) → 엔티티가 아니라 SQL로 바꾼다.
	 */
	@Transactional
	public List<ProjectInfo> reorder(UUID ownerId, List<UUID> ids) {
		Set<UUID> requested = new HashSet<>(ids);
		if (requested.size() != ids.size()) {
			throw Errors.invalid("projectIds", "DUPLICATE", "같은 프로젝트가 두 번 들어 있어요.");
		}
		lockOrder(ownerId);
		Set<UUID> all = new HashSet<>();
		Set<UUID> active = new HashSet<>();
		jdbc.sql("SELECT id, archived_at IS NULL AS active FROM project WHERE owner_id = ?")
				.param(ownerId)
				.query(rs -> {
					UUID id = rs.getObject("id", UUID.class);
					all.add(id);
					if (rs.getBoolean("active")) {
						active.add(id);
					}
				});
		if (!all.containsAll(requested)) {
			throw Errors.invalid("projectIds", "NOT_FOUND", "없는 프로젝트가 들어 있어요.");
		}
		if (!active.equals(requested)) {
			throw new ApiException(HttpStatus.CONFLICT, "PROJECT_ORDER_STALE",
					"다른 곳에서 프로젝트 목록이 바뀌었어요. 새로 불러온 뒤 다시 정해 주세요.");
		}
		jdbc.sql("""
						UPDATE project p SET position = t.ord
						FROM unnest(?::uuid[]) WITH ORDINALITY AS t(id, ord)
						WHERE p.id = t.id AND p.owner_id = ?""")
				.params(ids.toArray(UUID[]::new), ownerId)
				.update();
		return list(ownerId, false);
	}

	/** 보관한 프로젝트를 실제로 지운다 (카드 20261013-1010). 소속 업무는 남고 project_id가 비워진다(V10 ON DELETE SET NULL). */
	@Transactional
	public void purge(UUID ownerId, UUID id) {
		Project p = projects.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
		if (p.archivedAt() == null) {
			throw new ApiException(HttpStatus.CONFLICT, "PROJECT_NOT_ARCHIVED", "보관함에 있는 프로젝트만 영구 삭제할 수 있어요.");
		}
		projects.delete(p);
		projects.flush();
	}

	/**
	 * 같은 사용자의 추가·수정(보관·보관 해제)·순서 저장을 한 줄로 세운다(트랜잭션 끝에 풀림).
	 * 맨 아래 자리(max + 1)가 겹치거나, 순서 저장의 집합 확인 뒤에 목록이 바뀌는 것을 막는다.
	 */
	private void lockOrder(UUID ownerId) {
		jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(?::text, 0))").param(ownerId).query().singleRow();
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
		return new ProjectInfo(p.id(), p.name(), p.color(), p.position(), p.archivedAt(), counts.all(), counts.open(),
				p.createdAt(), p.version());
	}
}

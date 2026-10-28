package com.erp.worklog.project;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface ProjectRepository extends JpaRepository<Project, UUID> {

	Optional<Project> findByIdAndOwnerId(UUID id, UUID ownerId);

	/** 보관하지 않은 것 먼저, 그 안에서 사용자가 정한 순서 → id(UUIDv7이라 만든 순서). */
	@Query("select p from Project p where p.ownerId = :ownerId"
			+ " order by case when p.archivedAt is null then 0 else 1 end, p.position, p.id")
	List<Project> findAllOrdered(UUID ownerId);

	List<Project> findByOwnerIdAndArchivedAtIsNullOrderByPositionAscIdAsc(UUID ownerId);

	/** 맨 아래 자리: 보관한 것까지 포함한 가장 큰 position + 1. */
	@Query("select coalesce(max(p.position), 0) + 1 from Project p where p.ownerId = :ownerId")
	int nextPosition(UUID ownerId);

	/** 같은 이름(유니크 인덱스 project_owner_name과 같은 lower 비교)인 프로젝트 id. */
	@Query("select p.id from Project p where p.ownerId = :ownerId and lower(p.name) = lower(:name)")
	List<UUID> findIdsByName(UUID ownerId, String name);
}

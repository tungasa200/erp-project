package com.erp.worklog.project;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface ProjectRepository extends JpaRepository<Project, UUID> {

	Optional<Project> findByIdAndOwnerId(UUID id, UUID ownerId);

	/** UUIDv7이라 id 순서가 만든 순서다. */
	List<Project> findByOwnerIdOrderByIdAsc(UUID ownerId);

	List<Project> findByOwnerIdAndArchivedAtIsNullOrderByIdAsc(UUID ownerId);

	/** 같은 이름(유니크 인덱스 project_owner_name과 같은 lower 비교)인 프로젝트 id. */
	@Query("select p.id from Project p where p.ownerId = :ownerId and lower(p.name) = lower(:name)")
	List<UUID> findIdsByName(UUID ownerId, String name);
}

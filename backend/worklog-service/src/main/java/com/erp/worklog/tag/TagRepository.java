package com.erp.worklog.tag;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface TagRepository extends JpaRepository<Tag, UUID> {

	Optional<Tag> findByIdAndOwnerId(UUID id, UUID ownerId);

	List<Tag> findByOwnerIdOrderByNameAsc(UUID ownerId);

	/** 유니크 인덱스 tag_owner_name과 같은 비교 (lower). */
	@Query("select t from Tag t where t.ownerId = :ownerId and lower(t.name) = lower(:name)")
	Optional<Tag> findByName(UUID ownerId, String name);
}

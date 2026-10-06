package com.erp.worklog.schedule;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ScheduleRepository extends JpaRepository<Schedule, UUID> {

	Optional<Schedule> findByIdAndOwnerId(UUID id, UUID ownerId);

	/** 전체 구간(span)이 [from, to)와 겹치는 일정. 회차 전개는 엔티티가 한다. */
	@EntityGraph(attributePaths = "exceptions")
	@Query("""
			select s from Schedule s
			where s.ownerId = :ownerId and s.spanStart < :to and (s.spanEnd is null or s.spanEnd > :from)""")
	List<Schedule> findOverlapping(@Param("ownerId") UUID ownerId, @Param("from") Instant from, @Param("to") Instant to);

}

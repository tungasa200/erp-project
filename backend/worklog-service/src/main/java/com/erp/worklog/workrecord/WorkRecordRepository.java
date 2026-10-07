package com.erp.worklog.workrecord;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface WorkRecordRepository extends JpaRepository<WorkRecord, UUID> {

	Optional<WorkRecord> findByIdAndOwnerId(UUID id, UUID ownerId);

	/** 보관하지 않은 기록. */
	@Query("""
			select r from WorkRecord r
			where r.ownerId = :ownerId and r.deletedAt is null and r.workDate between :from and :to
			  and r.status in :statuses
			  and (:taskId is null or r.taskId = :taskId)
			order by r.workDate, r.startAt nulls last, r.occurrenceStart nulls last, r.id""")
	List<WorkRecord> findInRange(@Param("ownerId") UUID ownerId, @Param("from") LocalDate from, @Param("to") LocalDate to,
			@Param("statuses") Collection<WorkRecord.Status> statuses,
			@Param("taskId") UUID taskId);
}

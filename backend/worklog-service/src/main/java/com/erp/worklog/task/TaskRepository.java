package com.erp.worklog.task;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

interface TaskRepository extends JpaRepository<Task, UUID> {

	Optional<Task> findByIdAndOwnerId(UUID id, UUID ownerId);
}

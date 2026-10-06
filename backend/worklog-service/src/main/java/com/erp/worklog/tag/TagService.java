package com.erp.worklog.tag;

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
import java.util.Optional;
import java.util.UUID;

/** 태그 (P1-02). 사용 수는 보관하지 않은 업무만 센다. */
@Service
public class TagService {

	public record TagInfo(UUID id, String name, long usageCount, Instant createdAt, long version) {
	}

	private final TagRepository tags;
	private final JdbcClient jdbc;
	private final Clock clock;

	TagService(TagRepository tags, JdbcClient jdbc, Clock clock) {
		this.tags = tags;
		this.jdbc = jdbc;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public List<TagInfo> list(UUID ownerId) {
		Map<UUID, Long> counts = usageCounts(ownerId);
		return tags.findByOwnerIdOrderByNameAsc(ownerId).stream()
				.map(t -> info(t, counts.getOrDefault(t.id(), 0L)))
				.toList();
	}

	@Transactional(readOnly = true)
	public Optional<TagInfo> findByName(UUID ownerId, String name) {
		return tags.findByName(ownerId, name.strip()).map(t -> info(t, usageCounts(ownerId).getOrDefault(t.id(), 0L)));
	}

	/**
	 * 새로 만든다. 같은 이름이 있는지는 호출 쪽이 {@link #findByName}으로 먼저 본다.
	 * 그 사이 같은 이름이 들어오면 유니크 인덱스 때문에 DataIntegrityViolationException이 나며, 이 트랜잭션은 되돌려진다.
	 */
	@Transactional
	public TagInfo create(UUID ownerId, String name) {
		Tag tag = tags.saveAndFlush(new Tag(ownerId, name.strip(), clock.instant()));
		return info(tag, 0);
	}

	@Transactional
	public TagInfo rename(UUID ownerId, UUID id, long version, String name) {
		Tag tag = tags.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound);
		if (tag.version() != version) {
			throw Conflicts.versionConflict();
		}
		String trimmed = name.strip();
		if (tags.findByName(ownerId, trimmed).filter(other -> !other.id().equals(id)).isPresent()) {
			throw Errors.duplicateName();
		}
		tag.rename(trimmed, clock.instant());
		try {
			tags.saveAndFlush(tag);
		} catch (DataIntegrityViolationException e) {
			throw Errors.duplicateName();
		}
		return info(tag, usageCounts(ownerId).getOrDefault(id, 0L));
	}

	/** 실제로 지운다. 업무에 붙은 태그는 task_tag의 ON DELETE CASCADE로 함께 떨어진다. */
	@Transactional
	public void delete(UUID ownerId, UUID id) {
		tags.delete(tags.findByIdAndOwnerId(id, ownerId).orElseThrow(Errors::notFound));
	}

	private Map<UUID, Long> usageCounts(UUID ownerId) {
		Map<UUID, Long> counts = new HashMap<>();
		jdbc.sql("""
						SELECT tt.tag_id, count(*) AS n FROM task_tag tt JOIN task t ON t.id = tt.task_id
						WHERE t.owner_id = ? AND t.deleted_at IS NULL
						GROUP BY tt.tag_id""")
				.param(ownerId)
				.query((rs, i) -> counts.put(rs.getObject("tag_id", UUID.class), rs.getLong("n")))
				.list();
		return counts;
	}

	private static TagInfo info(Tag t, long usageCount) {
		return new TagInfo(t.id(), t.name(), usageCount, t.createdAt(), t.version());
	}
}

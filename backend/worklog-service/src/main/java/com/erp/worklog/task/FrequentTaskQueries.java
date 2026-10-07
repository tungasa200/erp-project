package com.erp.worklog.task;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * 자주 하는 업무 제안 (P2-04, REC-05, contracts/worklog.yaml listFrequentTasks).
 * 사건은 업무를 만든 시각과 업무에 연결된 확정(CONFIRMED) 기록의 시각(startAt → 회차 시작 → 만든 시각)이다.
 * 업무가 없는 기록은 대표 업무(latestTaskId)가 없어 세지 않는다. at 이전 8주, 사용자 시간대 하루 4구간(6시간씩) 중
 * at과 같은 구간에서 정규화한 제목별로 센다. 같은 요일에서 2번 이상인 것을 먼저, 3개가 안 되면 요일 무관으로 채운다.
 */
@Component
public class FrequentTaskQueries {

	static final int LIMIT = 3;
	static final Duration PERIOD = Duration.ofDays(56);

	public record FrequentTask(String title, UUID projectId, List<UUID> tagIds, UUID latestTaskId, int count) {
	}

	private record Group(String key, int count, int dayCount, Instant last, Instant dayLast, FrequentTask rep) {
	}

	private final JdbcClient jdbc;

	FrequentTaskQueries(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	@Transactional(readOnly = true)
	public List<FrequentTask> list(UUID ownerId, String timezone, Instant at) {
		ZonedDateTime local = at.atZone(ZoneId.of(timezone));
		Instant from = at.minus(PERIOD);
		// id는 UUIDv7(앞 48비트가 생성 밀리초)이라 task_owner_id (owner_id, id) 인덱스로 기간만 훑는다
		UUID idFloor = new UUID((from.toEpochMilli() << 16) | 0x7000L, Long.MIN_VALUE);

		List<Group> groups = jdbc.sql("""
						WITH ev AS (
						    SELECT t.id, t.title, t.project_id, t.created_at, t.created_at AS ev_at
						    FROM task t
						    WHERE t.owner_id = :owner AND t.deleted_at IS NULL
						      AND t.id >= :idFloor AND t.created_at >= :from AND t.created_at < :at
						    UNION ALL
						    SELECT t.id, t.title, t.project_id, t.created_at, coalesce(r.start_at, r.occurrence_start, r.created_at)
						    FROM work_record r JOIN task t ON t.id = r.task_id
						    WHERE r.owner_id = :owner AND r.deleted_at IS NULL AND r.status = 'CONFIRMED'
						      AND r.work_date BETWEEN :fromDate AND :atDate
						      AND t.owner_id = :owner AND t.deleted_at IS NULL
						), slot AS (
						    SELECT id, title, project_id, created_at, ev_at,
						           lower(btrim(regexp_replace(title, '\\s+', ' ', 'g'))) AS k,
						           extract(isodow FROM ev_at AT TIME ZONE :tz) = :dow AS same_day
						    FROM ev
						    WHERE ev_at >= :from AND ev_at < :at
						      AND floor(extract(hour FROM ev_at AT TIME ZONE :tz) / 6) = :bucket
						), agg AS (
						    SELECT k, count(*) AS n, count(*) FILTER (WHERE same_day) AS n_day,
						           max(ev_at) AS last_any, max(ev_at) FILTER (WHERE same_day) AS last_day
						    FROM slot GROUP BY k HAVING count(*) >= 2
						), rep AS (
						    SELECT DISTINCT ON (k) k, id, title, project_id FROM slot ORDER BY k, created_at DESC, id DESC
						)
						SELECT a.k, a.n, a.n_day, a.last_any, a.last_day, r.id, r.title,
						       CASE WHEN p.archived_at IS NULL THEN r.project_id END AS project_id,
						       ARRAY(SELECT tt.tag_id FROM task_tag tt WHERE tt.task_id = r.id ORDER BY tt.tag_id) AS tag_ids
						FROM agg a JOIN rep r ON r.k = a.k LEFT JOIN project p ON p.id = r.project_id""")
				.param("owner", ownerId)
				.param("tz", timezone)
				.param("dow", local.getDayOfWeek().getValue())
				.param("bucket", local.getHour() / 6)
				.param("idFloor", idFloor)
				.param("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC))
				.param("at", OffsetDateTime.ofInstant(at, ZoneOffset.UTC))
				// work_date는 기록 저장 때의 시간대 날짜라 지금 시간대와 하루 어긋날 수 있다: 앞뒤 하루씩 넓혀 인덱스로 거르고 ev_at으로 정확히 자른다
				.param("fromDate", from.atZone(ZoneOffset.UTC).toLocalDate().minusDays(1))
				.param("atDate", at.atZone(ZoneOffset.UTC).toLocalDate().plusDays(1))
				.query((rs, i) -> {
					Array tagArray = rs.getArray("tag_ids");
					List<UUID> tagIds = Arrays.stream((Object[]) tagArray.getArray()).map(UUID.class::cast).toList();
					OffsetDateTime dayLast = rs.getObject("last_day", OffsetDateTime.class);
					var rep = new FrequentTask(rs.getString("title"), rs.getObject("project_id", UUID.class), tagIds,
							rs.getObject("id", UUID.class), 0);
					return new Group(rs.getString("k"), rs.getInt("n"), rs.getInt("n_day"),
							rs.getObject("last_any", OffsetDateTime.class).toInstant(),
							dayLast == null ? null : dayLast.toInstant(), rep);
				})
				.list();

		List<FrequentTask> result = new ArrayList<>();
		groups.stream()
				.filter(g -> g.dayCount() >= 2)
				.sorted(Comparator.comparingInt(Group::dayCount).reversed().thenComparing(Group::dayLast, Comparator.reverseOrder())
						.thenComparing(Group::key))
				.limit(LIMIT)
				.forEach(g -> result.add(withCount(g, g.dayCount())));
		if (result.size() < LIMIT) {
			List<UUID> taken = result.stream().map(FrequentTask::latestTaskId).toList();
			groups.stream()
					.filter(g -> !taken.contains(g.rep().latestTaskId()))
					.sorted(Comparator.comparingInt(Group::count).reversed().thenComparing(Group::last, Comparator.reverseOrder())
							.thenComparing(Group::key))
					.limit(LIMIT - result.size())
					.forEach(g -> result.add(withCount(g, g.count())));
		}
		return result;
	}

	private static FrequentTask withCount(Group g, int count) {
		FrequentTask r = g.rep();
		return new FrequentTask(r.title(), r.projectId(), r.tagIds(), r.latestTaskId(), count);
	}
}

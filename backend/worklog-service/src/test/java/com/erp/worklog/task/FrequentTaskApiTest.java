package com.erp.worklog.task;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 자주 하는 업무 제안 (P2-04, contracts/worklog.yaml listFrequentTasks). ALICE는 Asia/Seoul.
 * 기준 시각 AT = 2026-10-07(수) 10:30 KST → 오전 구간(06–12).
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class FrequentTaskApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a3");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b3");
	static final Instant AT = Instant.parse("2026-10-07T01:30:00Z");
	static final AtomicLong SEQ = new AtomicLong();

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM work_record").update(); // 기록이 업무를 가리킨다 (work_record.task_id)
		jdbc.sql("DELETE FROM schedule").update();
		jdbc.sql("DELETE FROM task").update();
		jdbc.sql("DELETE FROM tag").update();
		jdbc.sql("DELETE FROM project").update();
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id IN (?, ?)").params(ALICE, BOB).update();
		for (UUID u : new UUID[] { ALICE, BOB }) {
			jdbc.sql("""
					INSERT INTO user_snapshot (user_id, timezone, week_start, work_days, last_seq, synced_at)
					VALUES (?, 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(u).update();
		}
	}

	@Test
	void sameWeekdayAndSlotFirstThenFillFromOtherWeekdays() throws Exception {
		// 같은 요일(수)·오전: 제목 표기가 달라도 정규화하면 한 묶음
		task(ALICE, "주간 보고", kst("2026-09-30T09:10"));
		task(ALICE, " 주간   보고", kst("2026-09-23T09:10"));
		task(ALICE, "주간 보고", kst("2026-09-16T11:59"));
		task(ALICE, "메일 확인", kst("2026-09-30T06:00"));
		task(ALICE, "메일 확인", kst("2026-09-23T07:00"));
		task(ALICE, "메일 확인", kst("2026-10-07T11:00")); // at 이후는 세지 않음
		task(ALICE, "회의 준비", kst("2026-09-30T10:00")); // 1번뿐
		// 다른 구간·기간 밖·보관·다른 사용자는 세지 않음
		task(ALICE, "점심 후 정리", kst("2026-09-30T12:00"));
		task(ALICE, "점심 후 정리", kst("2026-09-23T12:30"));
		task(ALICE, "옛날 일", kst("2026-08-05T09:00"));
		task(ALICE, "옛날 일", kst("2026-09-30T09:00"));
		deleted(task(ALICE, "보관함", kst("2026-09-30T09:00")));
		deleted(task(ALICE, "보관함", kst("2026-09-23T09:00")));
		for (int i = 1; i <= 4; i++) {
			task(BOB, "남의 일", kst("2026-09-30T09:00").minus(Duration.ofDays(7L * i)));
		}
		// 다른 요일(월)·오전: 채우기 후보
		task(ALICE, "코드 리뷰", kst("2026-10-05T08:00"));
		task(ALICE, "코드 리뷰", kst("2026-09-28T08:00"));
		task(ALICE, "코드 리뷰", kst("2026-09-21T08:00"));
		task(ALICE, "코드 리뷰", kst("2026-09-14T08:00"));
		task(ALICE, "코드 리뷰", kst("2026-09-07T08:00"));

		frequent(ALICE, "?at=" + AT)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.items[*].title").value(contains("주간 보고", "메일 확인", "코드 리뷰")))
				.andExpect(jsonPath("$.items[*].count").value(contains(3, 2, 5)));
	}

	@Test
	void representativeIsLatestTaskAndArchivedProjectIsNull() throws Exception {
		UUID project = project("영업", true);
		UUID tag = UUID.randomUUID();
		jdbc.sql("INSERT INTO tag (id, owner_id, name, version, created_at, updated_at) VALUES (?, ?, '견적', 0, now(), now())")
				.params(tag, ALICE).update();
		task(ALICE, "견적서", kst("2026-09-23T09:00"));
		UUID latest = task(ALICE, "견적서 ", kst("2026-09-30T09:00"));
		jdbc.sql("UPDATE task SET project_id = ? WHERE id = ?").params(project, latest).update();
		jdbc.sql("INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)").params(latest, tag).update();

		frequent(ALICE, "?at=" + AT)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.items.length()").value(1))
				.andExpect(jsonPath("$.items[0].title").value("견적서 "))
				.andExpect(jsonPath("$.items[0].latestTaskId").value(latest.toString()))
				.andExpect(jsonPath("$.items[0].projectId").value(nullValue()))
				.andExpect(jsonPath("$.items[0].tagIds").value(contains(tag.toString())));
	}

	@Test
	void confirmedRecordsAreEventsAtStartThenOccurrenceThenCreated() throws Exception {
		// 8주 전보다 먼저 만든 업무도 확정 기록이 있으면 센다. 시각: startAt → 회차 시작 → 만든 시각
		UUID standup = task(ALICE, "스탠드업", kst("2026-07-01T09:00"));
		record(standup, "CONFIRMED", kst("2026-09-30T09:00"), null, kst("2026-09-30T20:00"), false);
		record(standup, "CONFIRMED", null, kst("2026-09-23T09:30"), kst("2026-09-23T20:00"), false);
		record(standup, "CONFIRMED", null, null, kst("2026-09-16T10:00"), false);
		// 확인 대기·하지 않음·보관한 기록, 다른 구간의 기록은 세지 않는다
		record(standup, "PENDING", null, kst("2026-09-09T09:00"), kst("2026-09-09T09:00"), false);
		record(standup, "DISMISSED", null, kst("2026-09-02T09:00"), kst("2026-09-02T09:00"), false);
		record(standup, "CONFIRMED", kst("2026-09-02T08:00"), null, kst("2026-09-02T08:00"), true);
		record(standup, "CONFIRMED", kst("2026-08-26T13:00"), null, kst("2026-08-26T13:00"), false);
		// 업무 만든 시각과 그 업무의 확정 기록은 각각 사건이다
		UUID report = task(ALICE, "주간 보고", kst("2026-09-30T09:00"));
		record(report, "CONFIRMED", kst("2026-09-30T11:00"), null, kst("2026-09-30T11:00"), false);
		// 보관한 업무의 기록은 세지 않는다
		UUID gone = task(ALICE, "지운 일", kst("2026-07-01T09:00"));
		record(gone, "CONFIRMED", kst("2026-09-30T09:00"), null, kst("2026-09-30T09:00"), false);
		record(gone, "CONFIRMED", kst("2026-09-23T09:00"), null, kst("2026-09-23T09:00"), false);
		deleted(gone);

		frequent(ALICE, "?at=" + AT)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.items[*].title").value(contains("스탠드업", "주간 보고")))
				.andExpect(jsonPath("$.items[*].count").value(contains(3, 2)))
				.andExpect(jsonPath("$.items[0].latestTaskId").value(standup.toString()));
	}

	@Test
	void emptyWhenNothingRepeatsAndBadAtIs400() throws Exception {
		task(ALICE, "한 번", kst("2026-09-30T09:00"));
		frequent(ALICE, "?at=" + AT).andExpect(status().isOk()).andExpect(jsonPath("$.items").value(empty()));
		frequent(ALICE, "?at=abc").andExpect(status().isBadRequest());
	}

	private ResultActions frequent(UUID user, String query) throws Exception {
		return mvc.perform(get("/api/worklog/tasks/frequent" + query).with(jwt().jwt(j -> j.subject(user.toString()))));
	}

	private static Instant kst(String localDateTime) {
		return OffsetDateTime.parse(localDateTime + ":00+09:00").toInstant();
	}

	/** 만든 시각에 맞는 UUIDv7 id로 넣는다 (조회가 id 범위로 기간을 거른다). */
	private UUID task(UUID owner, String title, Instant createdAt) {
		UUID id = new UUID((createdAt.toEpochMilli() << 16) | 0x7000L | (SEQ.incrementAndGet() & 0xFFF),
				0x8000000000000000L | SEQ.get());
		OffsetDateTime at = OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC);
		jdbc.sql("""
				INSERT INTO task (id, owner_id, title, status, priority, progress, version, created_at, updated_at)
				VALUES (?, ?, ?, 'TODO', 'NORMAL', 0, 0, ?, ?)""").params(id, owner, title, at, at).update();
		return id;
	}

	private void record(UUID taskId, String status, Instant startAt, Instant occurrenceStart, Instant createdAt,
			boolean deleted) {
		OffsetDateTime created = OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC);
		Instant dateFrom = startAt != null ? startAt : occurrenceStart != null ? occurrenceStart : createdAt;
		jdbc.sql("""
				INSERT INTO work_record (id, owner_id, task_id, occurrence_start, status, work_date, content, start_at, end_at,
				                         deleted_at, version, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, '기록', ?, ?, CASE WHEN ? THEN now() END, 0, ?, ?)""")
				.params(UUID.randomUUID(), ALICE, taskId,
						occurrenceStart == null ? null : OffsetDateTime.ofInstant(occurrenceStart, ZoneOffset.UTC), status,
						dateFrom.atZone(java.time.ZoneId.of("Asia/Seoul")).toLocalDate(),
						startAt == null ? null : OffsetDateTime.ofInstant(startAt, ZoneOffset.UTC),
						startAt == null ? null : OffsetDateTime.ofInstant(startAt.plus(Duration.ofMinutes(30)), ZoneOffset.UTC),
						deleted, created, created)
				.update();
	}

	private void deleted(UUID taskId) {
		jdbc.sql("UPDATE task SET deleted_at = now() WHERE id = ?").params(taskId).update();
	}

	private UUID project(String name, boolean archived) {
		UUID id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO project (id, owner_id, name, color, archived_at, version, created_at, updated_at)
				VALUES (?, ?, ?, 'P1', CASE WHEN ? THEN now() END, 0, now(), now())""")
				.params(id, ALICE, name, archived).update();
		return id;
	}
}

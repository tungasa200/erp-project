package com.erp.worklog.workrecord;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 확인 대기 목록·모두 했어요 (P2-03, contracts/worklog.yaml listPendingRecords·confirmPendingRecords).
 * 지금 = 2026-10-07(수) 21:00 KST. ALICE는 Asia/Seoul이라 최근 7일은 10-01 ~ 10-07.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, PendingRecordApiTest.FixedClock.class })
class PendingRecordApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a5");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b5");
	static final Instant NOW = Instant.parse("2026-10-07T12:00:00Z");

	@TestConfiguration
	static class FixedClock {
		@Bean
		@Primary
		Clock fixedClock() {
			return Clock.fixed(NOW, ZoneOffset.UTC);
		}
	}

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		cleanUp();
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id IN (?, ?)").params(ALICE, BOB).update();
		for (UUID u : new UUID[] { ALICE, BOB }) {
			jdbc.sql("""
					INSERT INTO user_snapshot (user_id, timezone, week_start, work_days, last_seq, synced_at)
					VALUES (?, 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(u).update();
		}
	}

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_record").update();
		jdbc.sql("DELETE FROM schedule").update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 최근_7일의_끝난_회차만_한_번씩_만들고_계획_값을_붙인다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"스탠드업\"}"));
		// 매일 09:00–09:15 KST, 9-28부터: 10-01 ~ 10-07 일곱 회차가 범위 안이고 모두 끝났다
		String daily = schedule(ALICE, """
				{"title":"아침 회의","allDay":false,"startAt":"2026-09-28T00:00:00Z","endAt":"2026-09-28T00:15:00Z",
				 "recurrence":{"frequency":"DAILY"},"taskId":"%s"}""".formatted(task));
		// 오늘 22:00 KST는 아직 안 끝났다, 어제 종일은 끝났고 오늘 종일은 아직이다
		schedule(ALICE, """
				{"title":"야간","allDay":false,"startAt":"2026-10-07T13:00:00Z","endAt":"2026-10-07T14:00:00Z","taskId":"%s"}"""
				.formatted(task));
		schedule(ALICE, "{\"title\":\"워크숍\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"taskId\":\""
				+ task + "\"}");
		schedule(ALICE, "{\"title\":\"오늘 종일\",\"allDay\":true,\"startDate\":\"2026-10-07\",\"endDate\":\"2026-10-07\",\"taskId\":\""
				+ task + "\"}");
		// 업무가 없는 일정, 보관한 업무의 일정, 다른 사용자의 일정은 만들지 않는다
		schedule(ALICE, "{\"title\":\"업무 없음\",\"allDay\":false,\"startAt\":\"2026-10-06T01:00:00Z\",\"endAt\":\"2026-10-06T02:00:00Z\"}");
		String gone = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"지운 업무\"}"));
		schedule(ALICE, """
				{"title":"지운 업무 회의","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","taskId":"%s"}"""
				.formatted(gone));
		send(ALICE, delete("/api/worklog/tasks/" + gone), "").andExpect(status().isNoContent());
		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		schedule(BOB, """
				{"title":"남의 일정","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","taskId":"%s"}"""
				.formatted(bobTask));

		pending(ALICE)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(8))
			.andExpect(jsonPath("$.items[*].workDate").value(contains("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
					"2026-10-05", "2026-10-06", "2026-10-06", "2026-10-07")))
			.andExpect(jsonPath("$.items[*].status").value(everyItem(is("PENDING"))))
			.andExpect(jsonPath("$.items[*].taskId").value(everyItem(is(task))))
			.andExpect(jsonPath("$.items[*].startAt").value(everyItem(nullValue())))
			.andExpect(jsonPath("$.items[0].content").value("아침 회의"))
			.andExpect(jsonPath("$.items[0].scheduleId").value(daily))
			.andExpect(jsonPath("$.items[0].occurrenceStart").value("2026-10-01T00:00:00Z"))
			.andExpect(jsonPath("$.items[0].plan.title").value("아침 회의"))
			.andExpect(jsonPath("$.items[0].plan.allDay").value(false))
			.andExpect(jsonPath("$.items[0].plan.endAt").value("2026-10-01T00:15:00Z"))
			.andExpect(jsonPath("$.items[5].plan.allDay").value(true))
			.andExpect(jsonPath("$.items[5].plan.startDate").value("2026-10-06"));

		// 다시 불러도 늘지 않는다 (UNIQUE)
		pending(ALICE).andExpect(jsonPath("$.items.length()").value(8));
		assertThat(count()).isEqualTo(8);
		pending(BOB).andExpect(jsonPath("$.items.length()").value(1));
	}

	@Test
	void 처리하거나_보관한_회차는_다시_만들지_않고_일_보기는_7일_밖도_만든다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"정리\"}"));
		schedule(ALICE, """
				{"title":"정리","allDay":false,"startAt":"2026-09-28T00:00:00Z","endAt":"2026-09-28T00:15:00Z",
				 "recurrence":{"frequency":"DAILY"},"taskId":"%s"}""".formatted(task));
		List<String> ids = ids(pending(ALICE));
		assertThat(ids).hasSize(7);
		send(ALICE, patch("/api/worklog/records/" + ids.get(0)), "{\"version\":0,\"status\":\"DISMISSED\"}")
			.andExpect(status().isOk());
		send(ALICE, delete("/api/worklog/records/" + ids.get(1)), "").andExpect(status().isNoContent());
		pending(ALICE).andExpect(jsonPath("$.items.length()").value(5));
		assertThat(count()).isEqualTo(7);

		// 일 보기(from = to)는 7일 밖의 날도 만든다. 홈 목록에는 안 나온다
		send(ALICE, get("/api/worklog/records?from=2026-09-29&to=2026-09-29"), "")
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].status").value("PENDING"));
		pending(ALICE).andExpect(jsonPath("$.items.length()").value(5));
		// 여러 날 목록은 만들지 않는다
		send(ALICE, get("/api/worklog/records?from=2026-09-20&to=2026-09-28"), "")
			.andExpect(jsonPath("$.items.length()").value(0));
	}

	@Test
	void 모두_했어요는_보낸_확인_대기만_확정하고_나머지는_건너뛴다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"정리\"}"));
		schedule(ALICE, """
				{"title":"정리","allDay":false,"startAt":"2026-09-28T00:00:00Z","endAt":"2026-09-28T00:15:00Z",
				 "recurrence":{"frequency":"DAILY"},"taskId":"%s"}""".formatted(task));
		List<String> ids = ids(pending(ALICE));
		send(ALICE, patch("/api/worklog/records/" + ids.get(0)), "{\"version\":0,\"status\":\"DISMISSED\"}")
			.andExpect(status().isOk());
		String old = JsonPath.read(send(ALICE, get("/api/worklog/records?from=2026-09-29&to=2026-09-29"), "").andReturn()
			.getResponse().getContentAsString(), "$.items[0].id");
		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		schedule(BOB, """
				{"title":"남의 일정","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","taskId":"%s"}"""
				.formatted(bobTask));
		String bobPending = ids(pending(BOB)).getFirst();

		String body = "{\"ids\":[\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\"]}".formatted(ids.get(0), ids.get(2), ids.get(1), old,
				bobPending, UUID.randomUUID());
		send(ALICE, post("/api/worklog/records/pending/confirm"), body)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].id").value(contains(ids.get(1), ids.get(2))))
			.andExpect(jsonPath("$.items[*].status").value(everyItem(is("CONFIRMED"))))
			.andExpect(jsonPath("$.items[0].version").value(1));
		// 멱등
		send(ALICE, post("/api/worklog/records/pending/confirm"), body).andExpect(jsonPath("$.items.length()").value(0));
		pending(ALICE).andExpect(jsonPath("$.items.length()").value(4));
		pending(BOB).andExpect(jsonPath("$.items.length()").value(1));

		send(ALICE, post("/api/worklog/records/pending/confirm"), "{\"ids\":[]}").andExpect(status().isBadRequest());
		send(ALICE, post("/api/worklog/records/pending/confirm"), "{}").andExpect(status().isBadRequest());
	}

	private String schedule(UUID owner, String body) throws Exception {
		return id(send(owner, post("/api/worklog/schedules"), body).andExpect(status().isCreated()));
	}

	private ResultActions pending(UUID owner) throws Exception {
		return mvc.perform(get("/api/worklog/records/pending").with(user(owner)));
	}

	private long count() {
		return jdbc.sql("SELECT count(*) FROM work_record WHERE owner_id = ?").param(ALICE).query(Long.class).single();
	}

	private static List<String> ids(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.items[*].id");
	}

	private ResultActions send(UUID owner, MockHttpServletRequestBuilder request, String body) throws Exception {
		return mvc.perform(request.with(user(owner)).contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private static String id(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
	}

	private static RequestPostProcessor user(UUID id) {
		return jwt().jwt(j -> j.subject(id.toString()));
	}
}

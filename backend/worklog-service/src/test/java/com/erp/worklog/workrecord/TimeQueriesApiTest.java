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
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 소요시간 집계·빈 시간 (P2-07, contracts/worklog.yaml getTimeSummary·listTimeGaps).
 * 지금 = 2026-10-07(수) 15:00 KST. ALICE는 Asia/Seoul, 업무 시간대 09:00–18:00.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, TimeQueriesApiTest.FixedClock.class })
class TimeQueriesApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a7");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b7");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");

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
		jdbc.sql("DELETE FROM project WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 집계는_확정된_소요시간만_프로젝트별_업무별로_더한다() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String inProject = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"a\",\"projectId\":\"" + project + "\"}"));
		String loose = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		record(ALICE, "{\"content\":\"1\",\"workDate\":\"2026-10-06\",\"durationMin\":30,\"taskId\":\"" + inProject + "\"}");
		// 겹친 기록도 그대로 더한다
		record(ALICE, "{\"content\":\"2\",\"startAt\":\"2026-10-07T00:00:00Z\",\"endAt\":\"2026-10-07T01:30:00Z\",\"taskId\":\"" + inProject + "\"}");
		record(ALICE, "{\"content\":\"3\",\"startAt\":\"2026-10-07T01:00:00Z\",\"endAt\":\"2026-10-07T01:20:00Z\",\"taskId\":\"" + loose + "\"}");
		record(ALICE, "{\"content\":\"4\",\"workDate\":\"2026-10-07\",\"durationMin\":45}");
		// 시간 없는 기록·보관·범위 밖·남의 기록은 빠진다
		record(ALICE, "{\"content\":\"시간 없음\",\"workDate\":\"2026-10-07\"}");
		String archived = id(record(ALICE, "{\"content\":\"보관\",\"workDate\":\"2026-10-07\",\"durationMin\":100}"));
		send(ALICE, delete("/api/worklog/records/" + archived), "").andExpect(status().isNoContent());
		record(ALICE, "{\"content\":\"범위 밖\",\"workDate\":\"2026-10-08\",\"durationMin\":100}");
		record(BOB, "{\"content\":\"남의 것\",\"workDate\":\"2026-10-07\",\"durationMin\":100}");
		// 실행 중 타이머도 빠진다
		jdbc.sql("""
				INSERT INTO work_record (id, owner_id, status, work_date, content, start_at, version, created_at, updated_at)
				VALUES (?, ?, 'CONFIRMED', '2026-10-07', '타이머', now(), 0, now(), now())""").params(UUID.randomUUID(), ALICE).update();

		summary("from=2026-10-06&to=2026-10-07")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.from").value("2026-10-06"))
			.andExpect(jsonPath("$.totalMin").value(185))
			.andExpect(jsonPath("$.recordCount").value(4))
			.andExpect(jsonPath("$.projects.length()").value(2))
			.andExpect(jsonPath("$.projects[0].projectId").value(project))
			.andExpect(jsonPath("$.projects[0].minutes").value(120))
			.andExpect(jsonPath("$.projects[1].projectId").isEmpty())
			.andExpect(jsonPath("$.projects[1].minutes").value(65))
			.andExpect(jsonPath("$.tasks.length()").value(3))
			.andExpect(jsonPath("$.tasks[0].taskId").value(inProject))
			.andExpect(jsonPath("$.tasks[0].projectId").value(project))
			.andExpect(jsonPath("$.tasks[0].title").value("a"))
			.andExpect(jsonPath("$.tasks[1].title").isEmpty())
			.andExpect(jsonPath("$.tasks[1].taskId").isEmpty())
			.andExpect(jsonPath("$.tasks[1].minutes").value(45))
			.andExpect(jsonPath("$.tasks[2].taskId").value(loose))
			.andExpect(jsonPath("$.tasks[2].minutes").value(20));
		summary("from=2026-09-01&to=2026-09-30")
			.andExpect(jsonPath("$.totalMin").value(0))
			.andExpect(jsonPath("$.projects.length()").value(0));

		expectFieldError(summary("from=2026-10-07&to=2026-10-06"), "to", "INVALID_ORDER");
		expectFieldError(summary("from=2026-01-01&to=2027-02-06"), "to", "OUT_OF_RANGE");
		expectFieldError(summary("to=2026-10-07"), "from", "REQUIRED");
	}

	@Test
	void 빈_시간은_업무_시간대에서_15분_이상_구간과_후보를_준다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"정리\"}"));
		// 09:00–10:00, 10:10–11:00 KST 기록(사이 10분은 빼고), 14:00 KST부터 실행 중 타이머
		record(ALICE, "{\"content\":\"아침\",\"startAt\":\"2026-10-07T00:00:00Z\",\"endAt\":\"2026-10-07T01:00:00Z\"}");
		record(ALICE, "{\"content\":\"메일\",\"startAt\":\"2026-10-07T01:10:00Z\",\"endAt\":\"2026-10-07T02:00:00Z\",\"taskId\":\"" + task + "\"}");
		jdbc.sql("""
				INSERT INTO work_record (id, owner_id, status, work_date, content, start_at, version, created_at, updated_at)
				VALUES (?, ?, 'CONFIRMED', '2026-10-07', '타이머', '2026-10-07T05:00:00Z', 0, now(), now())""")
			.params(UUID.randomUUID(), ALICE).update();
		// 12:00–13:00 KST 끝난 계획(업무 연결 → 확인 대기가 생긴다), 11:00–11:40 KST 계획은 하지 않음으로 처리
		schedule("점심 회의", "2026-10-07T03:00:00Z", "2026-10-07T04:00:00Z", task);
		String done = schedule("짧은 회의", "2026-10-07T02:00:00Z", "2026-10-07T02:40:00Z", task);
		send(ALICE, get("/api/worklog/records/pending"), "");
		String dismissed = jdbc.sql("SELECT id FROM work_record WHERE schedule_id = ?").params(UUID.fromString(done))
			.query(UUID.class).single().toString();
		send(ALICE, patch("/api/worklog/records/" + dismissed), "{\"version\":0,\"status\":\"DISMISSED\"}")
			.andExpect(status().isOk());
		String pending = jdbc.sql("SELECT id FROM work_record WHERE status = 'PENDING' AND owner_id = ?").params(ALICE)
			.query(UUID.class).single().toString();

		gaps("2026-10-07")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].startAt").value("2026-10-07T02:00:00Z"))
			.andExpect(jsonPath("$.items[0].endAt").value("2026-10-07T05:00:00Z"))
			.andExpect(jsonPath("$.items[0].minutes").value(180))
			.andExpect(jsonPath("$.items[0].previous.content").value("메일"))
			.andExpect(jsonPath("$.items[0].previous.taskId").value(task))
			.andExpect(jsonPath("$.items[0].plan.title").value("점심 회의"))
			.andExpect(jsonPath("$.items[0].plan.pendingRecordId").value(pending))
			.andExpect(jsonPath("$.items[0].frequent").isEmpty());

		// 지난 날은 업무 시간대 전체, 미래는 없음
		gaps("2026-10-06")
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].startAt").value("2026-10-06T00:00:00Z"))
			.andExpect(jsonPath("$.items[0].minutes").value(540))
			.andExpect(jsonPath("$.items[0].previous").isEmpty())
			.andExpect(jsonPath("$.items[0].plan").isEmpty());
		gaps("2026-10-08").andExpect(jsonPath("$.items.length()").value(0));
		expectFieldError(send(ALICE, get("/api/worklog/records/gaps"), ""), "date", "REQUIRED");
	}

	private String schedule(String title, String startAt, String endAt, String task) throws Exception {
		return id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"%s","allDay":false,"startAt":"%s","endAt":"%s","taskId":"%s"}""".formatted(title, startAt, endAt, task)));
	}

	private ResultActions record(UUID owner, String body) throws Exception {
		return send(owner, post("/api/worklog/records"), body).andExpect(status().isCreated());
	}

	private ResultActions summary(String query) throws Exception {
		return send(ALICE, get("/api/worklog/records/time-summary?" + query), "");
	}

	private ResultActions gaps(String date) throws Exception {
		return send(ALICE, get("/api/worklog/records/gaps?date=" + date), "");
	}

	private static void expectFieldError(ResultActions result, String field, String code) throws Exception {
		result.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[?(@.field == '" + field + "')].code").value(code));
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

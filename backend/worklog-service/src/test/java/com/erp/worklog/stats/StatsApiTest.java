package com.erp.worklog.stats;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 통계·예상 대비 실제 (P4-02, contracts/worklog.yaml getStats·getPlanVsActual).
 * 지금 = 2026-10-07(수) 15:00 KST. ALICE는 Asia/Seoul, 주 시작 월요일.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, StatsApiTest.FixedClock.class })
class StatsApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a8");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b8");
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
		jdbc.sql("DELETE FROM work_log WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM project WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 통계는_완료_업무와_확정_기록과_확정_일지를_사용자_시간대로_센다() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String a = doneTask(ALICE, project, "2026-10-05T15:30:00Z", false); // KST 10-06 00:30
		doneTask(ALICE, null, "2026-10-05T14:00:00Z", false); // KST 10-05 23:00
		doneTask(ALICE, project, "2026-10-06T01:00:00Z", true); // 보관
		doneTask(ALICE, project, "2026-10-07T15:00:00Z", false); // KST 10-08, 범위 밖
		doneTask(BOB, null, "2026-10-06T01:00:00Z", false); // 남의 것
		record(ALICE, "{\"content\":\"1\",\"workDate\":\"2026-10-06\",\"taskId\":\"" + a + "\"}");
		record(ALICE, "{\"content\":\"2\",\"workDate\":\"2026-10-06\",\"taskId\":\"" + a + "\"}");
		record(ALICE, "{\"content\":\"3\",\"workDate\":\"2026-10-07\"}");
		record(ALICE, "{\"content\":\"예전\",\"workDate\":\"2026-09-01\"}");
		String archived = id(record(ALICE, "{\"content\":\"보관\",\"workDate\":\"2026-10-07\"}"));
		send(ALICE, delete("/api/worklog/records/" + archived), "").andExpect(status().isNoContent());
		log(ALICE, "DAILY", "2026-10-06", true);
		log(ALICE, "DAILY", "2026-10-07", false);
		log(ALICE, "WEEKLY", "2026-09-28", true); // 기간 시작일이 범위 밖

		stats(ALICE, "from=2026-10-05&to=2026-10-07")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.completedTaskCount").value(2))
			.andExpect(jsonPath("$.recordCount").value(3))
			.andExpect(jsonPath("$.confirmedLogCount").value(1))
			.andExpect(jsonPath("$.daily.length()").value(3))
			.andExpect(jsonPath("$.daily[0].date").value("2026-10-05"))
			.andExpect(jsonPath("$.daily[0].completedTaskCount").value(1))
			.andExpect(jsonPath("$.daily[0].recordCount").value(0))
			.andExpect(jsonPath("$.daily[1].completedTaskCount").value(1))
			.andExpect(jsonPath("$.daily[1].recordCount").value(2))
			.andExpect(jsonPath("$.daily[2].recordCount").value(1))
			.andExpect(jsonPath("$.projects.length()").value(2))
			.andExpect(jsonPath("$.projects[0].projectId").value(project))
			.andExpect(jsonPath("$.projects[0].completedTaskCount").value(1))
			.andExpect(jsonPath("$.projects[0].recordCount").value(2))
			.andExpect(jsonPath("$.projects[1].projectId").isEmpty())
			.andExpect(jsonPath("$.projects[1].recordCount").value(1))
			.andExpect(jsonPath("$.firstRecordDate").value("2026-09-01"));
		stats(BOB, "from=2026-10-05&to=2026-10-07")
			.andExpect(jsonPath("$.completedTaskCount").value(1))
			.andExpect(jsonPath("$.firstRecordDate").isEmpty());

		expectFieldError(stats(ALICE, "from=2026-10-07&to=2026-10-06"), "to", "INVALID_ORDER");
		expectFieldError(stats(ALICE, "from=2026-01-01&to=2027-02-06"), "to", "OUT_OF_RANGE");
		expectFieldError(stats(ALICE, "to=2026-10-07"), "from", "REQUIRED");
	}

	@Test
	void 예상_대비_실제는_업무에_연결된_시간_일정과_확정_소요시간을_주별로_비교한다() throws Exception {
		String x = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"x\"}"));
		String y = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"y\"}"));
		String z = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"z\"}"));
		schedule("{\"title\":\"x1\",\"allDay\":false,\"startAt\":\"2026-10-06T00:00:00Z\",\"endAt\":\"2026-10-06T01:00:00Z\",\"taskId\":\"" + x + "\"}");
		schedule("{\"title\":\"x2\",\"allDay\":false,\"startAt\":\"2026-10-13T00:00:00Z\",\"endAt\":\"2026-10-13T00:30:00Z\",\"taskId\":\"" + x + "\"}");
		schedule("{\"title\":\"y\",\"allDay\":false,\"startAt\":\"2026-10-07T00:00:00Z\",\"endAt\":\"2026-10-07T02:00:00Z\",\"taskId\":\"" + y + "\"}");
		// 업무 없는 일정·종일 일정은 예상에 넣지 않는다
		schedule("{\"title\":\"회의\",\"allDay\":false,\"startAt\":\"2026-10-08T00:00:00Z\",\"endAt\":\"2026-10-08T05:00:00Z\"}");
		schedule("{\"title\":\"종일\",\"allDay\":true,\"startDate\":\"2026-10-08\",\"endDate\":\"2026-10-08\",\"taskId\":\"" + z + "\"}");
		record(ALICE, "{\"content\":\"x\",\"workDate\":\"2026-10-06\",\"durationMin\":90,\"taskId\":\"" + x + "\"}");
		record(ALICE, "{\"content\":\"y\",\"workDate\":\"2026-10-07\",\"durationMin\":30,\"taskId\":\"" + y + "\"}");
		record(ALICE, "{\"content\":\"업무 없음\",\"workDate\":\"2026-10-07\",\"durationMin\":15}");
		record(ALICE, "{\"content\":\"z\",\"workDate\":\"2026-10-08\",\"durationMin\":20,\"taskId\":\"" + z + "\"}");
		record(ALICE, "{\"content\":\"시간 없음\",\"workDate\":\"2026-10-08\",\"taskId\":\"" + y + "\"}");

		send(ALICE, get("/api/worklog/stats/plan-vs-actual?from=2026-10-05&to=2026-10-18"), "")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.weeks.length()").value(2))
			.andExpect(jsonPath("$.weeks[0].weekStart").value("2026-10-05"))
			.andExpect(jsonPath("$.weeks[0].plannedMin").value(180))
			.andExpect(jsonPath("$.weeks[0].actualMin").value(120))
			.andExpect(jsonPath("$.weeks[0].unplannedMin").value(35))
			.andExpect(jsonPath("$.weeks[1].weekStart").value("2026-10-12"))
			.andExpect(jsonPath("$.weeks[1].plannedMin").value(30))
			.andExpect(jsonPath("$.weeks[1].actualMin").value(0))
			.andExpect(jsonPath("$.topDiffs.length()").value(2))
			.andExpect(jsonPath("$.topDiffs[0].taskId").value(y))
			.andExpect(jsonPath("$.topDiffs[0].title").value("y"))
			.andExpect(jsonPath("$.topDiffs[0].plannedMin").value(120))
			.andExpect(jsonPath("$.topDiffs[0].actualMin").value(30))
			.andExpect(jsonPath("$.topDiffs[1].taskId").value(x))
			.andExpect(jsonPath("$.topDiffs[1].plannedMin").value(90))
			.andExpect(jsonPath("$.topDiffs[1].actualMin").value(90));

		// 주 중간에서 시작하면 첫 주의 시작일은 기간 앞이다
		send(ALICE, get("/api/worklog/stats/plan-vs-actual?from=2026-10-07&to=2026-10-07"), "")
			.andExpect(jsonPath("$.weeks.length()").value(1))
			.andExpect(jsonPath("$.weeks[0].weekStart").value("2026-10-05"))
			.andExpect(jsonPath("$.weeks[0].plannedMin").value(120));
	}

	private String doneTask(UUID owner, String project, String completedAt, boolean archived) {
		UUID id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO task (id, owner_id, project_id, title, status, priority, progress, completed_at, deleted_at, version, created_at, updated_at)
				VALUES (?, ?, ?, 't', 'DONE', 'NORMAL', 100, ?::timestamptz, ?::timestamptz, 0, now(), now())""")
			.params(id, owner, project == null ? null : UUID.fromString(project), completedAt, archived ? completedAt : null)
			.update();
		return id.toString();
	}

	private void log(UUID owner, String type, String periodStart, boolean confirmed) {
		jdbc.sql("""
				INSERT INTO work_log (id, owner_id, type, period_start, period_end, status, content, confirmed_at, version, created_at, updated_at)
				VALUES (?, ?, ?, ?::date, ?::date + 6, ?, '{}'::jsonb, ?, 0, now(), now())""")
			.params(UUID.randomUUID(), owner, type, periodStart, periodStart, confirmed ? "CONFIRMED" : "DRAFT",
					confirmed ? java.sql.Timestamp.from(NOW) : null)
			.update();
	}

	private void schedule(String body) throws Exception {
		send(ALICE, post("/api/worklog/schedules"), body).andExpect(status().isCreated());
	}

	private ResultActions record(UUID owner, String body) throws Exception {
		return send(owner, post("/api/worklog/records"), body).andExpect(status().isCreated());
	}

	private ResultActions stats(UUID owner, String query) throws Exception {
		return send(owner, get("/api/worklog/stats?" + query), "");
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

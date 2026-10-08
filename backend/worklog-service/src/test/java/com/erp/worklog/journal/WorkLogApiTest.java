package com.erp.worklog.journal;

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

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 업무일지 보기·초안·확정·이력 (P3-02·03, contracts/worklog.yaml logs).
 * 지금 = 2026-10-07(수) 15:00 KST. ALICE는 Asia/Seoul, 월요일 시작, 월~금. 2026-10-09(금)는 한글날.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, WorkLogApiTest.FixedClock.class })
class WorkLogApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000001a7");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000001b7");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");
	static final String TODAY = "/api/worklog/logs/daily/2026-10-07";

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
					INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, last_seq, synced_at)
					VALUES (?, '홍길동', '개발팀', '', 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(u).update();
		}
	}

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_log WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM work_record WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM schedule WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM project WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM user_setting WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 미리보기는_저장하지_않고_원본이_없으면_기록_없음이다() throws Exception {
		send(ALICE, get(TODAY), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.id").value(nullValue()))
			.andExpect(jsonPath("$.status").value("NO_RECORDS"))
			.andExpect(jsonPath("$.version").value(0))
			.andExpect(jsonPath("$.content.title").value("업무일지"))
			.andExpect(jsonPath("$.content.author.name").value("홍길동"))
			.andExpect(jsonPath("$.content.author.position").value(nullValue()))
			.andExpect(jsonPath("$.content.achievementsAuto").value(true))
			.andExpect(jsonPath("$.content.planTitle").value("다음 근무일 계획"))
			.andExpect(jsonPath("$.content.planPeriod.start").value("2026-10-08"))
			.andExpect(jsonPath("$.content.time").value(nullValue()));

		record(ALICE, "{\"content\":\"정리\",\"workDate\":\"2026-10-07\"}");
		send(ALICE, get(TODAY), "").andExpect(jsonPath("$.status").value("NOT_WRITTEN"));
		send(BOB, get(TODAY), "").andExpect(jsonPath("$.status").value("NO_RECORDS"));
		org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT count(*) FROM work_log").query(Long.class).single())
			.isZero();
	}

	@Test
	void 일간_실적은_확정_기록_한_줄씩과_기록_없이_완료한_업무다() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"ERP\",\"color\":\"P1\"}"));
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"API\",\"projectId\":\"" + project + "\"}"));
		record(ALICE, "{\"content\":\"뒤\",\"workDate\":\"2026-10-07\",\"startAt\":\"2026-10-07T04:00:00Z\",\"endAt\":\"2026-10-07T05:00:00Z\"}");
		record(ALICE, "{\"content\":\"앞\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + task
				+ "\",\"outcome\":\"IN_PROGRESS\",\"progress\":40,\"startAt\":\"2026-10-07T01:00:00Z\",\"endAt\":\"2026-10-07T01:30:00Z\"}");
		record(ALICE, "{\"content\":\"어제\",\"workDate\":\"2026-10-06\"}");
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"끝난 일\",\"status\":\"DONE\",\"progress\":100}");
		String archived = id(record(ALICE, "{\"content\":\"보관\",\"workDate\":\"2026-10-07\"}"));
		send(ALICE, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/worklog/records/" + archived), "");
		jdbc.sql("""
				INSERT INTO work_record (id, owner_id, occurrence_start, status, work_date, content, version, created_at, updated_at)
				VALUES (?, ?, '2026-10-07T00:00:00Z', 'PENDING', '2026-10-07', '대기', 0, now(), now())""").params(UUID.randomUUID(), ALICE).update();

		send(ALICE, get(TODAY), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.content.achievements", hasSize(3)))
			.andExpect(jsonPath("$.content.achievements[0].text").value("앞"))
			.andExpect(jsonPath("$.content.achievements[0].projectName").value("ERP"))
			.andExpect(jsonPath("$.content.achievements[0].progress").value(40))
			.andExpect(jsonPath("$.content.achievements[0].source").value("RECORD"))
			.andExpect(jsonPath("$.content.achievements[0].dates[0]").value("2026-10-07"))
			.andExpect(jsonPath("$.content.achievements[0].durationMin").value(nullValue()))
			.andExpect(jsonPath("$.content.achievements[1].text").value("뒤"))
			.andExpect(jsonPath("$.content.achievements[2].text").value("끝난 일"))
			.andExpect(jsonPath("$.content.achievements[2].source").value("TASK"))
			.andExpect(jsonPath("$.content.achievements[2].outcome").value("DONE"))
			.andExpect(jsonPath("$.content.metrics.recordCount").value(2))
			.andExpect(jsonPath("$.content.metrics.completedTaskCount").value(1))
			.andExpect(jsonPath("$.content.metrics.done").value(1))
			.andExpect(jsonPath("$.content.metrics.inProgress").value(1))
			.andExpect(jsonPath("$.content.metrics.pendingCount").value(1))
			.andExpect(jsonPath("$.content.metrics.totalMin").value(nullValue()))
			.andExpect(jsonPath("$.planCandidates", hasSize(0)));

		// 시간 기록 옵션을 켜면 소요시간 표와 줄별 소요시간이 생긴다
		send(ALICE, patch("/api/worklog/me/settings"), "{\"version\":0,\"timeTrackingEnabled\":true}").andExpect(status().isOk());
		send(ALICE, get(TODAY), "")
			.andExpect(jsonPath("$.content.achievements[0].durationMin").value(30))
			.andExpect(jsonPath("$.content.metrics.totalMin").value(90))
			.andExpect(jsonPath("$.content.time.totalMin").value(90));
	}

	@Test
	void 계획_후보는_진행_중_마감_임박_마감_지남이다() throws Exception {
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"지남\",\"dueDate\":\"2026-10-01\"}");
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"내일\",\"dueDate\":\"2026-10-08\"}");
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"진행\",\"status\":\"IN_PROGRESS\"}");
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"멀다\",\"dueDate\":\"2026-12-01\"}");
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"보류\",\"status\":\"ON_HOLD\",\"dueDate\":\"2026-10-01\"}");

		send(ALICE, get(TODAY), "")
			.andExpect(jsonPath("$.planCandidates", hasSize(3)))
			.andExpect(jsonPath("$.planCandidates[0].title").value("지남"))
			.andExpect(jsonPath("$.planCandidates[0].reason").value("OVERDUE"))
			.andExpect(jsonPath("$.planCandidates[1].reason").value("DUE"))
			.andExpect(jsonPath("$.planCandidates[2].reason").value("IN_PROGRESS"));
	}

	@Test
	void 초안은_멱등으로_만들고_미래_기간과_잘못된_시작일은_400이다() throws Exception {
		send(ALICE, post(TODAY), "").andExpect(status().isCreated())
			.andExpect(jsonPath("$.status").value("DRAFT"))
			.andExpect(jsonPath("$.version").value(0));
		send(ALICE, post(TODAY), "").andExpect(status().isOk());
		expectFieldError(send(ALICE, post("/api/worklog/logs/daily/2026-10-08"), ""), "periodStart", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, get("/api/worklog/logs/weekly/2026-10-07"), ""), "periodStart", "INVALID_FORMAT");
		expectFieldError(send(ALICE, get("/api/worklog/logs/monthly/2026-10-02"), ""), "periodStart", "INVALID_FORMAT");
		expectFieldError(send(ALICE, get("/api/worklog/logs/yearly/2026-10-07"), ""), "type", "INVALID_FORMAT");
		send(ALICE, post("/api/worklog/logs/weekly/2026-10-05"), "").andExpect(status().isCreated())
			.andExpect(jsonPath("$.periodEnd").value("2026-10-11"));
	}

	@Test
	void 고친_실적은_고정되고_다시_채우기는_실적만_자동으로_돌린다() throws Exception {
		record(ALICE, "{\"content\":\"원본\",\"workDate\":\"2026-10-07\"}");
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"내일 할 일\",\"dueDate\":\"2026-10-20\"}"));
		String log = id(send(ALICE, post(TODAY), ""));
		String row = UUID.randomUUID().toString();

		send(ALICE, patch("/api/worklog/logs/" + log), """
				{"version":0,"achievements":[{"id":"%s","text":" 직접 쓴 줄 ","outcome":"DONE","source":"MANUAL"}],
				 "plans":[{"id":"%s","text":"이어서","taskId":"%s","dueDate":"2099-01-01"}],"issues":"막힘"}"""
				.formatted(row, UUID.randomUUID(), task))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.version").value(1))
			.andExpect(jsonPath("$.content.achievementsAuto").value(false))
			.andExpect(jsonPath("$.content.achievements", hasSize(1)))
			.andExpect(jsonPath("$.content.achievements[0].text").value("직접 쓴 줄"))
			.andExpect(jsonPath("$.content.plans[0].dueDate").value("2026-10-20"))
			.andExpect(jsonPath("$.content.issues").value("막힘"));

		// 원본이 늘어도 고친 실적은 그대로, 같은 값을 다시 보내면 version도 그대로
		record(ALICE, "{\"content\":\"새 기록\",\"workDate\":\"2026-10-07\"}");
		send(ALICE, get(TODAY), "").andExpect(jsonPath("$.content.achievements", hasSize(1)));
		send(ALICE, patch("/api/worklog/logs/" + log), "{\"version\":1,\"issues\":\"막힘\"}")
			.andExpect(jsonPath("$.version").value(1));
		send(ALICE, patch("/api/worklog/logs/" + log), "{\"version\":0,\"issues\":\"x\"}")
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
		expectFieldError(send(ALICE, patch("/api/worklog/logs/" + log),
				"{\"version\":1,\"achievements\":[{\"id\":\"" + row + "\",\"text\":\" \"}]}"), "achievements[0].text", "REQUIRED");

		send(ALICE, post("/api/worklog/logs/" + log + "/refill"), "{\"version\":1}").andExpect(status().isOk())
			.andExpect(jsonPath("$.version").value(2))
			.andExpect(jsonPath("$.content.achievementsAuto").value(true))
			.andExpect(jsonPath("$.content.achievements", hasSize(2)))
			.andExpect(jsonPath("$.content.plans", hasSize(1)))
			.andExpect(jsonPath("$.content.issues").value("막힘"));
	}

	@Test
	void 확정은_스냅샷과_이력을_남기고_해제하면_확정본이_초안이_된다() throws Exception {
		String rec = id(record(ALICE, "{\"content\":\"확정 전\",\"workDate\":\"2026-10-07\"}"));
		String log = id(send(ALICE, post(TODAY), ""));

		send(ALICE, post("/api/worklog/logs/" + log + "/confirm"), "{\"version\":0}").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.version").value(1))
			.andExpect(jsonPath("$.confirmedAt").value("2026-10-07T06:00:00Z"))
			.andExpect(jsonPath("$.sourceChangedAfterConfirm").value(false))
			.andExpect(jsonPath("$.content.achievementsAuto").value(false))
			.andExpect(jsonPath("$.planCandidates", hasSize(0)));

		// 원본을 고쳐도 확정본은 그대로, 바뀌었다는 표시만 켜진다
		jdbc.sql("UPDATE work_record SET content = '확정 뒤', updated_at = ? WHERE id = ?::uuid")
			.params(java.time.OffsetDateTime.parse("2026-10-07T07:00:00Z"), rec).update();
		send(ALICE, get(TODAY), "")
			.andExpect(jsonPath("$.content.achievements[0].text").value("확정 전"))
			.andExpect(jsonPath("$.sourceChangedAfterConfirm").value(true));

		send(ALICE, patch("/api/worklog/logs/" + log), "{\"version\":1,\"issues\":\"x\"}")
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LOG_CONFIRMED"));
		send(ALICE, post("/api/worklog/logs/" + log + "/confirm"), "{\"version\":1}")
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LOG_CONFIRMED"));

		send(ALICE, post("/api/worklog/logs/" + log + "/unconfirm"), "{\"version\":1}").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("DRAFT"))
			.andExpect(jsonPath("$.content.achievementsAuto").value(false))
			.andExpect(jsonPath("$.content.achievements[0].text").value("확정 전"));
		send(ALICE, post("/api/worklog/logs/" + log + "/unconfirm"), "{\"version\":2}")
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LOG_NOT_CONFIRMED"));
		send(ALICE, post("/api/worklog/logs/" + log + "/confirm"), "{\"version\":2}").andExpect(status().isOk());

		send(ALICE, get("/api/worklog/logs/" + log + "/revisions"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.items", hasSize(2)))
			.andExpect(jsonPath("$.items[0].revisionNo").value(2))
			.andExpect(jsonPath("$.items[0].unconfirmedAt").value(nullValue()))
			.andExpect(jsonPath("$.items[1].unconfirmedAt").value("2026-10-07T06:00:00Z"));
		send(ALICE, get("/api/worklog/logs/" + log + "/revisions/1"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.revisionNo").value(1))
			.andExpect(jsonPath("$.content.achievements[0].text").value("확정 전"));
		send(ALICE, get("/api/worklog/logs/" + log + "/revisions/9"), "").andExpect(status().isNotFound());
	}

	@Test
	void 다른_사용자의_일지는_없는_것과_같다() throws Exception {
		String log = id(send(ALICE, post(TODAY), ""));
		send(BOB, patch("/api/worklog/logs/" + log), "{\"version\":0,\"issues\":\"x\"}").andExpect(status().isNotFound());
		send(BOB, post("/api/worklog/logs/" + log + "/confirm"), "{\"version\":0}").andExpect(status().isNotFound());
		send(BOB, get("/api/worklog/logs/" + log + "/revisions"), "").andExpect(status().isNotFound());
		send(BOB, get(TODAY), "").andExpect(jsonPath("$.id").value(nullValue()));
	}

	private ResultActions record(UUID owner, String body) throws Exception {
		return send(owner, post("/api/worklog/records"), body).andExpect(status().isCreated());
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

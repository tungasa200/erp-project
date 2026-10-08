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

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 하루 마감 (P3-05)과 일지 목록 (P3-08). 지금 = 2026-10-07(수) 15:00 KST. ALICE는 Asia/Seoul, 월요일 시작, 월~금.
 * 2026-10-05(월)는 대체공휴일, 10-09(금)는 한글날이라 그 주 근무일은 화~목 3일, 마지막 근무일은 10-08(목)이다.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, DailyCloseApiTest.FixedClock.class })
class DailyCloseApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000002a7");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000002b7");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");
	static final String CLOSE = "/api/worklog/logs/daily/2026-10-07/close";

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
	void 마감_준비는_이월_후보와_계획_범위와_제안을_준다() throws Exception {
		String recorded = task(ALICE, "{\"title\":\"기록함\"}");
		task(ALICE, "{\"title\":\"내일 마감\",\"dueDate\":\"2026-10-08\"}");
		task(ALICE, "{\"title\":\"진행\",\"status\":\"IN_PROGRESS\",\"progress\":30}");
		String far = task(ALICE, "{\"title\":\"멀다\",\"dueDate\":\"2026-12-01\"}");
		task(ALICE, "{\"title\":\"보류\",\"status\":\"ON_HOLD\",\"dueDate\":\"2026-10-01\"}");
		record(ALICE, "{\"content\":\"했다\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + recorded + "\"}");
		// 업무에 이은 끝난 시간 일정 회차 → 확인 대기 1건 (GET /records/pending과 같은 규칙). 확인 대기는 이월 후보 근거가 아니다
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"회의","allDay":false,"startAt":"2026-10-07T01:00:00Z","endAt":"2026-10-07T02:00:00Z","taskId":"%s"}""".formatted(far))
			.andExpect(status().isCreated());

		send(ALICE, get(CLOSE), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.date").value("2026-10-07"))
			.andExpect(jsonPath("$.log.status").value("NOT_WRITTEN"))
			.andExpect(jsonPath("$.log.workday").value(true))
			.andExpect(jsonPath("$.pendingCount").value(1))
			.andExpect(jsonPath("$.nextWorkday").value("2026-10-08"))
			.andExpect(jsonPath("$.planScope").value("NEXT_WORKDAY"))
			.andExpect(jsonPath("$.carryOverCandidates", hasSize(3)))
			.andExpect(jsonPath("$.carryOverCandidates[0].title").value("내일 마감"))
			.andExpect(jsonPath("$.carryOverCandidates[1].title").value("기록함"))
			.andExpect(jsonPath("$.carryOverCandidates[2].title").value("진행"))
			.andExpect(jsonPath("$.carryOverCandidates[2].progress").value(30))
			.andExpect(jsonPath("$.carryOverCandidates[2].selected").value(true))
			.andExpect(jsonPath("$.suggestions", hasSize(0)));

		// 목요일은 한글날(금) 때문에 그 주 마지막 근무일: 다음 주 계획, 주간 제안
		send(ALICE, get("/api/worklog/logs/daily/2026-10-08/close"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.nextWorkday").value("2026-10-12"))
			.andExpect(jsonPath("$.planScope").value("NEXT_WEEK"))
			.andExpect(jsonPath("$.suggestions", hasSize(1)))
			.andExpect(jsonPath("$.suggestions[0].type").value("WEEKLY"))
			.andExpect(jsonPath("$.suggestions[0].periodStart").value("2026-10-05"))
			.andExpect(jsonPath("$.suggestions[0].periodEnd").value("2026-10-11"))
			.andExpect(jsonPath("$.suggestions[0].logStatus").value("NOT_WRITTEN"))
			.andExpect(jsonPath("$.suggestions[0].unconfirmedDates", hasSize(3))); // 10-05는 대체공휴일
	}

	@Test
	void 마감은_초안을_만들고_이월과_이슈를_넣어_확정한다() throws Exception {
		String task = task(ALICE, "{\"title\":\"API 마무리\",\"dueDate\":\"2026-10-08\"}");

		ResultActions closed = send(ALICE, post(CLOSE),
				"{\"version\":0,\"carryOverTaskIds\":[\"" + task + "\"],\"issue\":\" 서버 느림 \"}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.log.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.log.content.plans", hasSize(1)))
			.andExpect(jsonPath("$.log.content.plans[0].text").value("API 마무리"))
			.andExpect(jsonPath("$.log.content.plans[0].taskId").value(task))
			.andExpect(jsonPath("$.log.content.plans[0].dueDate").value("2026-10-08"))
			.andExpect(jsonPath("$.log.content.issues").value("서버 느림"))
			.andExpect(jsonPath("$.suggestions", hasSize(0)));
		String logId = JsonPath.read(closed.andReturn().getResponse().getContentAsString(), "$.log.id");
		int version = JsonPath.read(closed.andReturn().getResponse().getContentAsString(), "$.log.version");
		assertThat(jdbc.sql("SELECT count(*) FROM work_log_revision WHERE log_id = ?::uuid").param(logId).query(Long.class).single())
			.isEqualTo(1);
		// 업무 자체는 바뀌지 않는다
		send(ALICE, get("/api/worklog/tasks/" + task), "").andExpect(jsonPath("$.dueDate").value("2026-10-08"));

		send(ALICE, post(CLOSE), "{\"version\":" + version + ",\"carryOverTaskIds\":[]}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("LOG_CONFIRMED"));

		// 해제 → 이슈를 고친 초안 → 다시 마감: 같은 업무는 한 번만, 이슈는 끝에 한 줄
		ResultActions draft = send(ALICE, post("/api/worklog/logs/" + logId + "/unconfirm"), "{\"version\":" + version + "}")
			.andExpect(status().isOk());
		version = JsonPath.read(draft.andReturn().getResponse().getContentAsString(), "$.version");
		draft = send(ALICE, patch("/api/worklog/logs/" + logId), "{\"version\":" + version + ",\"issues\":\"기존\"}")
			.andExpect(status().isOk());
		version = JsonPath.read(draft.andReturn().getResponse().getContentAsString(), "$.version");
		send(ALICE, post(CLOSE), "{\"version\":" + version + ",\"carryOverTaskIds\":[\"" + task + "\"],\"issue\":\"둘째\"}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.log.content.plans", hasSize(1)))
			.andExpect(jsonPath("$.log.content.issues").value("기존\n둘째"));
		assertThat(jdbc.sql("SELECT count(*) FROM work_log_revision WHERE log_id = ?::uuid").param(logId).query(Long.class).single())
			.isEqualTo(2);
	}

	@Test
	void 마감_오류는_아무것도_저장하지_않는다() throws Exception {
		String bobs = task(BOB, "{\"title\":\"남의 것\"}");
		String archived = task(ALICE, "{\"title\":\"보관\"}");
		send(ALICE, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/worklog/tasks/" + archived), "");

		expectFieldError(send(ALICE, post("/api/worklog/logs/daily/2026-10-08/close"), "{\"version\":0,\"carryOverTaskIds\":[]}"),
				"date", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, post(CLOSE), "{\"version\":0,\"carryOverTaskIds\":[\"" + bobs + "\"]}"),
				"carryOverTaskIds", "NOT_FOUND");
		expectFieldError(send(ALICE, post(CLOSE), "{\"version\":0,\"carryOverTaskIds\":[\"" + archived + "\"]}"),
				"carryOverTaskIds", "NOT_FOUND");
		expectFieldError(send(ALICE, post(CLOSE), "{\"version\":0}"), "carryOverTaskIds", "REQUIRED");
		send(ALICE, post(CLOSE), "{\"version\":3,\"carryOverTaskIds\":[]}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
		assertThat(jdbc.sql("SELECT count(*) FROM work_log WHERE owner_id = ?").param(ALICE).query(Long.class).single()).isZero();
	}

	@Test
	void 목록은_기간마다_상태를_준다() throws Exception {
		record(ALICE, "{\"content\":\"화요일\",\"workDate\":\"2026-10-06\"}");
		send(ALICE, post(CLOSE), "{\"version\":0,\"carryOverTaskIds\":[]}").andExpect(status().isOk());

		send(ALICE, get("/api/worklog/logs?type=DAILY&from=2026-10-05&to=2026-10-11"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.items", hasSize(7)))
			.andExpect(jsonPath("$.items[0].status").value("NO_RECORDS"))
			.andExpect(jsonPath("$.items[0].workday").value(false))
			.andExpect(jsonPath("$.items[0].logId").value(nullValue()))
			.andExpect(jsonPath("$.items[1].status").value("NOT_WRITTEN"))
			.andExpect(jsonPath("$.items[2].status").value("CONFIRMED"))
			.andExpect(jsonPath("$.items[2].workday").value(true))
			.andExpect(jsonPath("$.items[4].workday").value(false))
			.andExpect(jsonPath("$.items[4].holiday").value("한글날"))
			.andExpect(jsonPath("$.items[5].holiday").value(nullValue()))
			.andExpect(jsonPath("$.unconfirmedDays").value(1));
		send(BOB, get("/api/worklog/logs?type=DAILY&from=2026-10-05&to=2026-10-11"), "")
			.andExpect(jsonPath("$.items[2].status").value("NO_RECORDS"));

		send(ALICE, get("/api/worklog/logs?type=WEEKLY&from=2026-10-01&to=2026-10-14"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.items", hasSize(3)))
			.andExpect(jsonPath("$.items[0].periodStart").value("2026-09-28"))
			.andExpect(jsonPath("$.items[1].periodEnd").value("2026-10-11"))
			.andExpect(jsonPath("$.items[1].status").value("NOT_WRITTEN"))
			.andExpect(jsonPath("$.items[1].days.workdays").value(3))
			.andExpect(jsonPath("$.items[1].days.confirmed").value(1));
		send(ALICE, get("/api/worklog/logs?type=MONTHLY&from=2026-10-01&to=2026-10-31"), "")
			.andExpect(jsonPath("$.items", hasSize(1)))
			.andExpect(jsonPath("$.items[0].periodEnd").value("2026-10-31"));

		expectFieldError(send(ALICE, get("/api/worklog/logs?type=daily&from=2026-10-05&to=2026-10-11"), ""), "type", "INVALID_FORMAT");
		expectFieldError(send(ALICE, get("/api/worklog/logs?type=DAILY&from=2026-10-05&to=2026-10-04"), ""), "to", "INVALID_ORDER");
		expectFieldError(send(ALICE, get("/api/worklog/logs?type=DAILY&from=2025-01-01&to=2026-10-04"), ""), "to", "OUT_OF_RANGE");
	}

	private String task(UUID owner, String body) throws Exception {
		return id(send(owner, post("/api/worklog/tasks"), body).andExpect(status().isCreated()));
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

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 주간·월간 일지 생성 (P3-07 LOG-07·08). 지금 = 2026-10-07(수) 15:00 KST, 그 주는 10-05(월, 대체공휴일) ~ 10-11.
 * 10-06은 일간 일지를 확정한 뒤 기록을 하나 더 넣어, 주간이 그날 스냅샷을 쓰는지 본다.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, PeriodLogApiTest.FixedClock.class })
class PeriodLogApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000003a7");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");
	static final String WEEK = "/api/worklog/logs/weekly/2026-10-05";

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

	String api;

	@BeforeEach
	void reset() throws Exception {
		cleanUp();
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id = ?").params(ALICE).update();
		jdbc.sql("""
				INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, last_seq, synced_at)
				VALUES (?, '홍길동', '개발팀', '', 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(ALICE).update();

		String project = id(send(post("/api/worklog/projects"), "{\"name\":\"ERP\",\"color\":\"P1\"}"));
		api = id(send(post("/api/worklog/tasks"), "{\"title\":\"API\",\"projectId\":\"" + project + "\"}"));
		String doc = id(send(post("/api/worklog/tasks"), "{\"title\":\"문서\"}"));
		send(post("/api/worklog/tasks"), "{\"title\":\"끝난 일\",\"status\":\"DONE\",\"progress\":100}"); // 10-07 완료, 기록 없음

		record("{\"content\":\"설계\",\"workDate\":\"2026-10-06\",\"taskId\":\"" + api
				+ "\",\"result\":\"초안\",\"outcome\":\"IN_PROGRESS\",\"progress\":30}");
		record("{\"content\":\"메모\",\"workDate\":\"2026-10-06\"}");
		send(post("/api/worklog/logs/daily/2026-10-06/close"), "{\"version\":0,\"carryOverTaskIds\":[]}")
			.andExpect(status().isOk());
		record("{\"content\":\"확정 뒤\",\"workDate\":\"2026-10-06\"}");
		record("{\"content\":\"구현\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + api + "\",\"outcome\":\"IN_PROGRESS\",\"progress\":60}");
		record("{\"content\":\"초안 쓰기\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + doc + "\"}");
	}

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_log WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM work_record WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM task WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM project WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM user_setting WHERE owner_id = ?").params(ALICE).update();
	}

	@Test
	void 주간은_확정_일간_스냅샷과_원본을_업무별로_묶는다() throws Exception {
		send(get(WEEK), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("NOT_WRITTEN"))
			.andExpect(jsonPath("$.content.title").value("주간 업무일지"))
			.andExpect(jsonPath("$.content.planTitle").value("다음 주 계획"))
			.andExpect(jsonPath("$.content.planPeriod.start").value("2026-10-12"))
			.andExpect(jsonPath("$.content.days", hasSize(7)))
			.andExpect(jsonPath("$.content.days[0].source").value("NONE"))
			.andExpect(jsonPath("$.content.days[0].workday").value(false))
			.andExpect(jsonPath("$.content.days[0].holiday").value("대체공휴일(개천절)"))
			.andExpect(jsonPath("$.content.days[1].source").value("CONFIRMED_LOG"))
			.andExpect(jsonPath("$.content.days[2].source").value("RECORDS"))
			.andExpect(jsonPath("$.content.days[3].source").value("NONE"))
			// 업무 API는 한 줄: 업무 제목, 마지막으로 적은 결과, 마지막 진행률, 두 날
			.andExpect(jsonPath("$.content.achievements", hasSize(4)))
			.andExpect(jsonPath("$.content.achievements[0].id").value(api))
			.andExpect(jsonPath("$.content.achievements[0].text").value("API"))
			.andExpect(jsonPath("$.content.achievements[0].result").value("초안"))
			.andExpect(jsonPath("$.content.achievements[0].progress").value(60))
			.andExpect(jsonPath("$.content.achievements[0].projectName").value("ERP"))
			.andExpect(jsonPath("$.content.achievements[0].dates", hasSize(2)))
			.andExpect(jsonPath("$.content.achievements[0].recordIds", hasSize(2)))
			.andExpect(jsonPath("$.content.achievements[0].source").value("RECORD"))
			// 10-06은 확정 스냅샷: 확정 뒤 기록은 실적에 없다
			.andExpect(jsonPath("$.content.achievements[1].text").value("메모"))
			.andExpect(jsonPath("$.content.achievements[2].text").value("문서"))
			.andExpect(jsonPath("$.content.achievements[3].text").value("끝난 일"))
			.andExpect(jsonPath("$.content.achievements[3].source").value("TASK"))
			// 수치·프로젝트는 원본으로
			.andExpect(jsonPath("$.content.metrics.recordCount").value(5))
			.andExpect(jsonPath("$.content.projects", hasSize(2)))
			.andExpect(jsonPath("$.content.projects[0].name").value("ERP"))
			.andExpect(jsonPath("$.content.projects[0].recordCount").value(2))
			.andExpect(jsonPath("$.content.projects[0].completedTaskCount").value(0))
			.andExpect(jsonPath("$.content.projects[0].minutes").value(nullValue()))
			.andExpect(jsonPath("$.content.projects[1].projectId").value(nullValue()))
			.andExpect(jsonPath("$.content.projects[1].recordCount").value(3))
			.andExpect(jsonPath("$.content.projects[1].completedTaskCount").value(1));

		String logId = id(send(post(WEEK), "").andExpect(status().isCreated()));
		send(post("/api/worklog/logs/" + logId + "/confirm"), "{\"version\":0}").andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.content.achievementsAuto").value(false))
			.andExpect(jsonPath("$.content.days", hasSize(7)))
			.andExpect(jsonPath("$.content.achievements", hasSize(4)));
	}

	@Test
	void 월간은_날마다_출처와_프로젝트별_실적을_준다() throws Exception {
		send(get("/api/worklog/logs/monthly/2026-10-01"), "").andExpect(status().isOk())
			.andExpect(jsonPath("$.content.title").value("월간 업무일지"))
			.andExpect(jsonPath("$.content.planTitle").value("다음 달 계획"))
			.andExpect(jsonPath("$.content.planPeriod.start").value("2026-11-01"))
			.andExpect(jsonPath("$.content.days", hasSize(31)))
			.andExpect(jsonPath("$.content.days[5].source").value("CONFIRMED_LOG"))
			.andExpect(jsonPath("$.content.achievements", hasSize(4)))
			.andExpect(jsonPath("$.content.projects", hasSize(2)));

		// 일간 미리보기는 days·projects가 빈 배열
		send(get("/api/worklog/logs/daily/2026-10-07"), "")
			.andExpect(jsonPath("$.content.days", hasSize(0)))
			.andExpect(jsonPath("$.content.projects", hasSize(0)));
	}

	private void record(String body) throws Exception {
		send(post("/api/worklog/records"), body).andExpect(status().isCreated());
	}

	private ResultActions send(MockHttpServletRequestBuilder request, String body) throws Exception {
		return mvc.perform(request.with(user(ALICE)).contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private static String id(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
	}

	private static RequestPostProcessor user(UUID id) {
		return jwt().jwt(j -> j.subject(id.toString()));
	}
}

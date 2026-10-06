package com.erp.worklog.schedule;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 일정 API (P1-05·06, contracts/worklog.yaml schedules). ALICE는 Asia/Seoul, BOB은 서머타임이 있는 America/New_York. */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class ScheduleApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a5");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b5");

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM schedule").update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM project WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id IN (?, ?)").params(ALICE, BOB).update();
		snapshot(ALICE, "Asia/Seoul");
		snapshot(BOB, "America/New_York");
	}

	/** 같은 DB를 쓰는 다른 테스트가 업무를 지울 때 schedule.task_id FK에 걸리지 않게 남기지 않는다. */
	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM schedule").update();
	}

	@Test
	void 시간_일정을_만들고_기간으로_조회하며_다른_사용자는_못_본다() throws Exception {
		String id = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"  주간 회의 ","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","memo":"안건"}""")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.title").value("주간 회의"))
			.andExpect(jsonPath("$.timezone").value("Asia/Seoul"))
			.andExpect(jsonPath("$.recurrence").isEmpty())
			.andExpect(jsonPath("$.version").value(0)));

		list(ALICE, "2026-10-05T15:00:00Z", "2026-10-06T15:00:00Z").andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].scheduleId").value(id))
			.andExpect(jsonPath("$.items[0].occurrenceStart").value("2026-10-06T01:00:00Z"))
			.andExpect(jsonPath("$.items[0].recurring").value(false))
			.andExpect(jsonPath("$.items[0].memo").value("안건"));
		// [from, to)라 끝난 시각부터 시작하는 범위에는 없다
		list(ALICE, "2026-10-06T02:00:00Z", "2026-10-07T00:00:00Z").andExpect(jsonPath("$.items.length()").value(0));

		list(BOB, "2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z").andExpect(jsonPath("$.items.length()").value(0));
		send(BOB, get("/api/worklog/schedules/" + id), "").andExpect(status().isNotFound());
		send(BOB, delete("/api/worklog/schedules/" + id), "").andExpect(status().isNotFound());
	}

	@Test
	void 종일_일정은_일정_시간대의_날짜로_겹침을_본다() throws Exception {
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"워크숍","allDay":true,"startDate":"2026-10-06","endDate":"2026-10-07"}""")
			.andExpect(status().isCreated());
		// 서울 10/7 하루(10/6 15:00Z ~ 10/7 15:00Z)만 보아도 나온다
		list(ALICE, "2026-10-06T15:00:00Z", "2026-10-07T15:00:00Z").andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].allDay").value(true))
			.andExpect(jsonPath("$.items[0].startDate").value("2026-10-06"))
			.andExpect(jsonPath("$.items[0].endDate").value("2026-10-07"))
			.andExpect(jsonPath("$.items[0].occurrenceStart").value("2026-10-05T15:00:00Z"));
		list(ALICE, "2026-10-07T15:00:00Z", "2026-10-08T15:00:00Z").andExpect(jsonPath("$.items.length()").value(0));
	}

	@Test
	void 매주_반복을_회차로_전개하고_이_일정만_바꾸거나_뺀다() throws Exception {
		// 2026-10-05(월) 10:00 서울, 월·목, 4회
		String id = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"스탠드업","allDay":false,"startAt":"2026-10-05T01:00:00Z","endAt":"2026-10-05T01:30:00Z",
				 "recurrence":{"frequency":"WEEKLY","weekdays":["THURSDAY","MONDAY"],"count":4}}""")
			.andExpect(jsonPath("$.recurrence.weekdays", contains("MONDAY", "THURSDAY"))));
		String range = "from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z";
		assertThat(keys(ALICE, range)).containsExactly("2026-10-05T01:00:00Z", "2026-10-08T01:00:00Z",
				"2026-10-12T01:00:00Z", "2026-10-15T01:00:00Z");

		// 목요일 회차를 금요일 오후로 옮기고 제목만 바꾼다 (키는 그대로)
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-10-08T01:00:00Z"), """
				{"version":0,"title":"스탠드업(이동)","startAt":"2026-10-09T05:00:00Z","endAt":"2026-10-09T05:30:00Z"}""")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.occurrenceStart").value("2026-10-08T01:00:00Z"))
			.andExpect(jsonPath("$.modified").value(true))
			.andExpect(jsonPath("$.startAt").value("2026-10-09T05:00:00Z"))
			.andExpect(jsonPath("$.version").value(1));
		// 셋째 회차 삭제, 다시 삭제해도 204
		send(ALICE, delete("/api/worklog/schedules/" + id + "/occurrences/2026-10-12T01:00:00Z"), "")
			.andExpect(status().isNoContent());
		send(ALICE, delete("/api/worklog/schedules/" + id + "/occurrences/2026-10-12T01:00:00Z"), "")
			.andExpect(status().isNoContent());

		list(ALICE, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z").andExpect(jsonPath("$.items.length()").value(3))
			.andExpect(jsonPath("$.items[1].title").value("스탠드업(이동)"))
			.andExpect(jsonPath("$.items[1].startAt").value("2026-10-09T05:00:00Z"))
			.andExpect(jsonPath("$.items[2].occurrenceStart").value("2026-10-15T01:00:00Z"))
			.andExpect(jsonPath("$.items[2].modified").value(false));

		// 회차가 아닌 키, 삭제한 회차, 옛 version
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-10-06T01:00:00Z"), "{\"version\":2}")
			.andExpect(status().isNotFound());
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-10-12T01:00:00Z"), "{\"version\":2}")
			.andExpect(status().isNotFound());
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-10-15T01:00:00Z"), "{\"version\":0}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
	}

	@Test
	void 모든_일정_수정은_제목만이면_회차_변경을_남기고_시각을_바꾸면_지운다() throws Exception {
		String id = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"점검","allDay":false,"startAt":"2026-10-05T01:00:00Z","endAt":"2026-10-05T02:00:00Z",
				 "recurrence":{"frequency":"DAILY","count":3}}"""));
		send(ALICE, delete("/api/worklog/schedules/" + id + "/occurrences/2026-10-06T01:00:00Z"), "");
		String range = "from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z";

		send(ALICE, patch("/api/worklog/schedules/" + id), "{\"version\":1,\"title\":\"정기 점검\"}")
			.andExpect(jsonPath("$.version").value(2));
		assertThat(keys(ALICE, range)).containsExactly("2026-10-05T01:00:00Z", "2026-10-07T01:00:00Z");

		send(ALICE, patch("/api/worklog/schedules/" + id), """
				{"version":2,"startAt":"2026-10-05T03:00:00Z","endAt":"2026-10-05T04:00:00Z"}""").andExpect(status().isOk());
		assertThat(keys(ALICE, range)).containsExactly("2026-10-05T03:00:00Z", "2026-10-06T03:00:00Z",
				"2026-10-07T03:00:00Z");

		// 반복 없애기, 그 뒤로는 회차 API가 409
		send(ALICE, patch("/api/worklog/schedules/" + id), "{\"version\":3,\"recurrence\":null}")
			.andExpect(jsonPath("$.recurrence").isEmpty());
		assertThat(keys(ALICE, range)).containsExactly("2026-10-05T03:00:00Z");
		send(ALICE, delete("/api/worklog/schedules/" + id + "/occurrences/2026-10-05T03:00:00Z"), "")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("NOT_RECURRING"));
	}

	@Test
	void 서머타임이_바뀌어도_같은_현지_시각에_반복한다() throws Exception {
		// 뉴욕 2026-10-30(금) 09:00 EDT = 13:00Z, 11/1 서머타임 끝 → 11/2부터 09:00 EST = 14:00Z
		send(BOB, post("/api/worklog/schedules"), """
				{"title":"daily","allDay":false,"startAt":"2026-10-30T13:00:00Z","endAt":"2026-10-30T13:30:00Z",
				 "recurrence":{"frequency":"DAILY","count":4}}""").andExpect(status().isCreated());
		assertThat(keys(BOB, "from=2026-10-29T00:00:00Z&to=2026-11-05T00:00:00Z")).containsExactly(
				"2026-10-30T13:00:00Z", "2026-10-31T13:00:00Z", "2026-11-01T14:00:00Z", "2026-11-02T14:00:00Z");
	}

	@Test
	void 매월_31일은_없는_달을_건너뛰고_옮긴_마지막_회차도_찾는다() throws Exception {
		String id = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"월말 정산","allDay":true,"startDate":"2026-01-31","endDate":"2026-01-31",
				 "recurrence":{"frequency":"MONTHLY","count":3}}"""));
		assertThat(keys(ALICE, "from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z")).containsExactly(
				"2026-01-30T15:00:00Z", "2026-03-30T15:00:00Z", "2026-05-30T15:00:00Z");

		// 마지막 회차를 원래 구간 밖(7월)으로 옮겨도 그 기간 조회에 나온다
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-05-30T15:00:00Z"), """
				{"version":0,"startDate":"2026-07-01","endDate":"2026-07-01"}""").andExpect(status().isOk());
		list(ALICE, "2026-06-30T15:00:00Z", "2026-07-01T15:00:00Z").andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].startDate").value("2026-07-01"));
	}

	@Test
	void 입력_검증() throws Exception {
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"startAt\":\"2026-10-06T00:00:00Z\"}"),
				"startAt", "INVALID_FORMAT");
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":false,\"startAt\":\"2026-10-06T02:00:00Z\",\"endAt\":\"2026-10-06T02:00:00Z\"}"),
				"endAt", "INVALID_ORDER");
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\" \",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\"}"), "title", "REQUIRED");
		// 2026-10-06은 화요일인데 월요일만
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"recurrence\":{\"frequency\":\"WEEKLY\",\"weekdays\":[\"MONDAY\"]}}"),
				"recurrence.weekdays", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"recurrence\":{\"frequency\":\"DAILY\",\"until\":\"2026-10-10\",\"count\":3}}"),
				"recurrence.count", "INVALID_FORMAT");
		expectFieldError(send(ALICE, get("/api/worklog/schedules?from=2026-01-01T00:00:00Z&to=2027-03-01T00:00:00Z"), ""),
				"to", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, get("/api/worklog/schedules?to=2026-03-01T00:00:00Z"), ""), "from", "REQUIRED");
	}

	@Test
	void 연결_업무는_내_업무만() throws Exception {
		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		expectFieldError(send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"taskId\":\"" + bobTask + "\"}"),
				"taskId", "NOT_FOUND");
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"a\"}"));
		send(ALICE, post("/api/worklog/schedules"),
				"{\"title\":\"t\",\"allDay\":true,\"startDate\":\"2026-10-06\",\"endDate\":\"2026-10-06\",\"taskId\":\"" + task + "\"}")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.taskId").value(task));
	}

	@Test
	void 회차에_연결_업무의_프로젝트를_싣고_보관한_업무도_그대로_준다() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"일정 프로젝트\",\"color\":\"P3\"}"));
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"a\",\"projectId\":\"" + project + "\"}"));
		String noProjectTask = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		String id = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"연결","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","taskId":"%s",
				 "recurrence":{"frequency":"DAILY","count":2}}""".formatted(task)));
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"프로젝트 없음","allDay":false,"startAt":"2026-10-06T03:00:00Z","endAt":"2026-10-06T04:00:00Z","taskId":"%s"}"""
			.formatted(noProjectTask));
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"업무 없음","allDay":false,"startAt":"2026-10-06T05:00:00Z","endAt":"2026-10-06T06:00:00Z"}""");

		list(ALICE, "2026-10-05T15:00:00Z", "2026-10-06T15:00:00Z").andExpect(jsonPath("$.items.length()").value(3))
			.andExpect(jsonPath("$.items[0].projectId").value(project))
			.andExpect(jsonPath("$.items[1].projectId").isEmpty())
			.andExpect(jsonPath("$.items[2].projectId").isEmpty());
		send(ALICE, patch("/api/worklog/schedules/" + id + "/occurrences/2026-10-07T01:00:00Z"), "{\"version\":0,\"title\":\"x\"}")
			.andExpect(jsonPath("$.projectId").value(project));

		send(ALICE, delete("/api/worklog/tasks/" + task), "").andExpect(status().isNoContent());
		list(ALICE, "2026-10-05T15:00:00Z", "2026-10-06T15:00:00Z").andExpect(jsonPath("$.items[0].projectId").value(project));
	}

	@Test
	void 업무_id로_거르면_그_업무의_회차만_주고_남의_업무는_빈_목록() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"a\"}"));
		String otherTask = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"c\"}"));
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"반복","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z","taskId":"%s",
				 "recurrence":{"frequency":"DAILY","count":3}}""".formatted(task)).andExpect(status().isCreated());
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"한 번","allDay":true,"startDate":"2026-10-10","endDate":"2026-10-10","taskId":"%s"}""".formatted(task))
			.andExpect(status().isCreated());
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"다른 업무","allDay":false,"startAt":"2026-10-06T03:00:00Z","endAt":"2026-10-06T04:00:00Z","taskId":"%s"}"""
			.formatted(otherTask)).andExpect(status().isCreated());
		send(ALICE, post("/api/worklog/schedules"), """
				{"title":"업무 없음","allDay":false,"startAt":"2026-10-06T05:00:00Z","endAt":"2026-10-06T06:00:00Z"}""")
			.andExpect(status().isCreated());
		send(BOB, post("/api/worklog/schedules"), """
				{"title":"밥","allDay":false,"startAt":"2026-10-06T07:00:00Z","endAt":"2026-10-06T08:00:00Z","taskId":"%s"}"""
			.formatted(bobTask)).andExpect(status().isCreated());
		String range = "from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z";

		// 반복 회차(3개)와 종일 일정, 기간 밖 회차는 빠진다
		assertThat(keys(ALICE, range + "&taskId=" + task)).containsExactly("2026-10-06T01:00:00Z", "2026-10-07T01:00:00Z",
				"2026-10-08T01:00:00Z", "2026-10-09T15:00:00Z");
		assertThat(keys(ALICE, "from=2026-10-07T00:00:00Z&to=2026-10-08T00:00:00Z&taskId=" + task))
			.containsExactly("2026-10-07T01:00:00Z");
		assertThat(keys(ALICE, range)).hasSize(6);

		// 남의 업무·없는 업무는 존재 여부를 드러내지 않고 빈 목록
		assertThat(keys(ALICE, range + "&taskId=" + bobTask)).isEmpty();
		assertThat(keys(ALICE, range + "&taskId=" + UUID.randomUUID())).isEmpty();
		assertThat(keys(BOB, range + "&taskId=" + bobTask)).containsExactly("2026-10-06T07:00:00Z");

		expectFieldError(send(ALICE, get("/api/worklog/schedules?" + range + "&taskId=abc"), ""), "taskId", "INVALID_FORMAT");
	}

	private void snapshot(UUID user, String timezone) {
		jdbc.sql("""
				INSERT INTO user_snapshot (user_id, timezone, week_start, work_days, last_seq, synced_at)
				VALUES (?, ?, 'MONDAY', 31, 0, now())""").params(user, timezone).update();
	}

	private List<String> keys(UUID user, String query) throws Exception {
		String body = send(user, get("/api/worklog/schedules?" + query), "").andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
		return JsonPath.read(body, "$.items[*].occurrenceStart");
	}

	private ResultActions list(UUID user, String from, String to) throws Exception {
		return send(user, get("/api/worklog/schedules?from=" + from + "&to=" + to), "").andExpect(status().isOk());
	}

	private static void expectFieldError(ResultActions result, String field, String code) throws Exception {
		result.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].field").value(field))
			.andExpect(jsonPath("$.errors[0].code").value(code));
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

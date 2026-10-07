package com.erp.worklog.workrecord;

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

import java.sql.Timestamp;
import java.time.Instant;
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

/** 업무 기록 API (P2-01, contracts/worklog.yaml records). */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class WorkRecordApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a4");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b4");

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

	/** 같은 DB를 쓰는 다른 테스트가 업무·일정을 지울 때 FK에 걸리지 않게 남기지 않는다. */
	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_record").update();
		jdbc.sql("DELETE FROM schedule").update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM project WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM tag WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 직접_쓴_기록은_확정으로_만들고_startAt이_있으면_사용자_시간대로_날짜를_정한다() throws Exception {
		send(ALICE, post("/api/worklog/records"), """
				{"content":"  견적서 작성 ","workDate":"2026-10-07","result":"  ","outcome":"IN_PROGRESS","progress":40,"durationMin":30}""")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.content").value("견적서 작성"))
			.andExpect(jsonPath("$.workDate").value("2026-10-07"))
			.andExpect(jsonPath("$.result").isEmpty())
			.andExpect(jsonPath("$.progress").value(40))
			.andExpect(jsonPath("$.durationMin").value(30))
			.andExpect(jsonPath("$.tagIds.length()").value(0))
			.andExpect(jsonPath("$.scheduleId").isEmpty())
			.andExpect(jsonPath("$.version").value(0));

		// 16:00Z는 서울 다음날 01:00 — 보낸 workDate는 무시하고, 소요시간은 서버가 계산한다
		send(ALICE, post("/api/worklog/records"), """
				{"content":"야간 배포","workDate":"2026-10-01","startAt":"2026-10-07T16:00:00Z","endAt":"2026-10-07T17:30:00Z"}""")
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.workDate").value("2026-10-08"))
			.andExpect(jsonPath("$.durationMin").value(90));

		// 시작만 있으면 진행 중(소요시간 없음)
		send(ALICE, post("/api/worklog/records"), "{\"content\":\"타이머\",\"startAt\":\"2026-10-07T01:00:00Z\"}")
			.andExpect(jsonPath("$.endAt").isEmpty())
			.andExpect(jsonPath("$.durationMin").isEmpty());
	}

	@Test
	void 입력_규칙을_검사한다() throws Exception {
		expectFieldError(send(ALICE, post("/api/worklog/records"), "{\"content\":\"t\"}"), "workDate", "REQUIRED");
		expectFieldError(send(ALICE, post("/api/worklog/records"), "{\"content\":\" \",\"workDate\":\"2026-10-07\"}"),
				"content", "REQUIRED");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"endAt\":\"2026-10-07T01:00:00Z\"}"), "endAt", "INVALID_ORDER");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"startAt\":\"2026-10-07T01:00:00Z\",\"endAt\":\"2026-10-07T01:00:00Z\"}"), "endAt", "INVALID_ORDER");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"startAt\":\"2026-10-07T01:00:00Z\",\"durationMin\":10}"), "durationMin", "INVALID_FORMAT");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"outcome\":\"DONE\",\"progress\":50}"), "progress", "INVALID_FORMAT");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"outcome\":\"IN_PROGRESS\",\"progress\":15}"), "progress", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"outcome\":\"LATER\"}"), "outcome", "INVALID_FORMAT");
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"durationMin\":0}"), "durationMin", "OUT_OF_RANGE");

		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		expectFieldError(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + bobTask + "\"}"), "taskId", "NOT_FOUND");
	}

	@Test
	void 기간_목록은_보관을_빼고_정렬하며_상태와_업무로_거른다() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String tag = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"t\"}"));
		String task = id(send(ALICE, post("/api/worklog/tasks"),
				"{\"title\":\"업무\",\"projectId\":\"" + project + "\",\"tagIds\":[\"" + tag + "\"]}"));
		String noTime = id(record(ALICE, "{\"content\":\"시간 없음\",\"workDate\":\"2026-10-07\"}"));
		String late = id(record(ALICE, "{\"content\":\"늦게\",\"startAt\":\"2026-10-07T05:00:00Z\",\"taskId\":\"" + task + "\"}"));
		String early = id(record(ALICE, "{\"content\":\"일찍\",\"startAt\":\"2026-10-07T01:00:00Z\"}"));
		String prev = id(record(ALICE, "{\"content\":\"전날\",\"workDate\":\"2026-10-06\"}"));
		String archived = id(record(ALICE, "{\"content\":\"보관\",\"workDate\":\"2026-10-07\"}"));
		send(ALICE, delete("/api/worklog/records/" + archived), "").andExpect(status().isNoContent());
		record(BOB, "{\"content\":\"남의 기록\",\"workDate\":\"2026-10-07\"}");
		String pending = plan(ALICE, null, "2026-10-07T08:00:00Z", "PENDING", "2026-10-07");

		list("from=2026-10-06&to=2026-10-07")
			.andExpect(jsonPath("$.items[*].id").value(contains(prev, early, late, pending, noTime)))
			.andExpect(jsonPath("$.items[2].projectId").value(project))
			.andExpect(jsonPath("$.items[2].tagIds", contains(tag)));
		list("from=2026-10-07&to=2026-10-07&status=PENDING").andExpect(jsonPath("$.items[*].id").value(contains(pending)));
		list("from=2026-10-01&to=2026-10-31&taskId=" + task).andExpect(jsonPath("$.items[*].id").value(contains(late)));

		expectFieldError(list("from=2026-10-07&to=2026-10-06"), "to", "INVALID_ORDER");
		expectFieldError(list("from=2026-01-01&to=2027-02-06"), "to", "OUT_OF_RANGE");
		expectFieldError(list("from=2026-10-07&to=2026-10-07&status=WAITING"), "status", "INVALID_FORMAT");
		expectFieldError(list("to=2026-10-07"), "from", "REQUIRED");
	}

	@Test
	void 수정은_보낸_칸만_바꾸고_같은_값이면_version을_올리지_않는다() throws Exception {
		String id = id(record(ALICE, "{\"content\":\"t\",\"workDate\":\"2026-10-07\",\"result\":\"초안\"}"));

		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":0,\"outcome\":\"IN_PROGRESS\",\"progress\":60}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.result").value("초안"))
			.andExpect(jsonPath("$.progress").value(60))
			.andExpect(jsonPath("$.version").value(1));
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"outcome\":\"IN_PROGRESS\",\"progress\":60}")
			.andExpect(jsonPath("$.version").value(1));
		// 진행 중을 벗어나면 진행률도 함께 비워야 한다
		expectFieldError(send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"outcome\":\"DONE\"}"),
				"progress", "INVALID_FORMAT");
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"outcome\":\"DONE\",\"progress\":null,\"result\":null}")
			.andExpect(jsonPath("$.outcome").value("DONE"))
			.andExpect(jsonPath("$.progress").isEmpty())
			.andExpect(jsonPath("$.result").isEmpty())
			.andExpect(jsonPath("$.version").value(2));

		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"content\":\"늦은 저장\"}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":2,\"status\":\"DISMISSED\"}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("INVALID_STATUS"));
		send(BOB, patch("/api/worklog/records/" + id), "{\"version\":2,\"content\":\"x\"}").andExpect(status().isNotFound());
	}

	@Test
	void 날짜는_startAt이_바뀔_때만_다시_계산하고_시간대를_바꿔도_그대로다() throws Exception {
		String id = id(record(ALICE, "{\"content\":\"t\",\"startAt\":\"2026-10-07T16:00:00Z\"}"));
		jdbc.sql("UPDATE user_snapshot SET timezone = 'America/New_York' WHERE user_id = ?").params(ALICE).update();

		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":0,\"content\":\"내용만\",\"workDate\":\"2026-01-01\"}")
			.andExpect(jsonPath("$.workDate").value("2026-10-08"));
		// 뉴욕 기준 10/7 12:00
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"startAt\":\"2026-10-07T16:00:01Z\"}")
			.andExpect(jsonPath("$.workDate").value("2026-10-07"));
		// 시간을 비우면 날짜는 보낸 값
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":2,\"startAt\":null,\"workDate\":\"2026-10-09\"}")
			.andExpect(jsonPath("$.workDate").value("2026-10-09"))
			.andExpect(jsonPath("$.startAt").isEmpty());
	}

	@Test
	void 계획에서_온_기록은_세_상태를_오간다() throws Exception {
		String id = plan(ALICE, null, "2026-10-07T01:00:00Z", "PENDING", "2026-10-07");
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":0,\"status\":\"CONFIRMED\",\"content\":\"고친 내용\"}")
			.andExpect(jsonPath("$.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.occurrenceStart").value("2026-10-07T01:00:00Z"));
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"status\":\"DISMISSED\"}")
			.andExpect(jsonPath("$.status").value("DISMISSED"));
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":2,\"status\":\"PENDING\"}")
			.andExpect(jsonPath("$.status").value("PENDING"));
	}

	@Test
	void 보관한_기록은_조회만_되고_복원해야_고칠_수_있다() throws Exception {
		String id = id(record(ALICE, "{\"content\":\"t\",\"workDate\":\"2026-10-07\"}"));
		send(ALICE, delete("/api/worklog/records/" + id), "").andExpect(status().isNoContent());
		send(ALICE, delete("/api/worklog/records/" + id), "").andExpect(status().isNoContent());
		send(ALICE, get("/api/worklog/records/" + id), "").andExpect(jsonPath("$.deletedAt").isNotEmpty());
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"content\":\"x\"}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("RECORD_DELETED"));
		send(ALICE, post("/api/worklog/records/" + id + "/restore"), "")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.deletedAt").isEmpty());
		send(BOB, delete("/api/worklog/records/" + id), "").andExpect(status().isNotFound());
		send(BOB, get("/api/worklog/records/" + id), "").andExpect(status().isNotFound());
	}

	@Test
	void 일정_시각을_바꾸거나_지우면_확인_대기만_지우고_나머지는_남긴다() throws Exception {
		String schedule = id(send(ALICE, post("/api/worklog/schedules"), """
				{"title":"회의","allDay":false,"startAt":"2026-10-06T01:00:00Z","endAt":"2026-10-06T02:00:00Z",
				 "recurrence":{"frequency":"DAILY"}}"""));
		UUID scheduleId = UUID.fromString(schedule);
		String pending = plan(ALICE, scheduleId, "2026-10-06T01:00:00Z", "PENDING", "2026-10-06");
		String confirmed = plan(ALICE, scheduleId, "2026-10-07T01:00:00Z", "CONFIRMED", "2026-10-07");
		String pending8 = plan(ALICE, scheduleId, "2026-10-08T01:00:00Z", "PENDING", "2026-10-08");
		String pending9 = plan(ALICE, scheduleId, "2026-10-09T01:00:00Z", "PENDING", "2026-10-09");

		// 회차 하나를 지우면 그 회차의 확인 대기만
		send(ALICE, delete("/api/worklog/schedules/" + schedule + "/occurrences/2026-10-08T01:00:00Z"), "")
			.andExpect(status().isNoContent());
		assertThat(exists(pending8)).isFalse();
		assertThat(exists(pending)).isTrue();

		// 제목만 바꾸면 그대로, 시각을 바꾸면 이 일정의 확인 대기를 모두 지운다
		send(ALICE, patch("/api/worklog/schedules/" + schedule), "{\"version\":" + version(schedule) + ",\"title\":\"새 제목\"}")
			.andExpect(status().isOk());
		assertThat(exists(pending)).isTrue();
		send(ALICE, patch("/api/worklog/schedules/" + schedule), "{\"version\":" + version(schedule) + ",\"endAt\":\"2026-10-06T03:00:00Z\"}")
			.andExpect(status().isOk());
		assertThat(exists(pending)).isFalse();
		assertThat(exists(pending9)).isFalse();

		// 일정을 지우면 확정 기록은 남고 출처 회차 키도 남는다
		send(ALICE, delete("/api/worklog/schedules/" + schedule), "").andExpect(status().isNoContent());
		send(ALICE, get("/api/worklog/records/" + confirmed), "")
			.andExpect(jsonPath("$.scheduleId").isEmpty())
			.andExpect(jsonPath("$.occurrenceStart").value("2026-10-07T01:00:00Z"));
	}

	/** 계획에서 온 기록 (P2-03 전이라 SQL로 넣는다). */
	private String plan(UUID owner, UUID scheduleId, String occurrenceStart, String status, String workDate) {
		UUID id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO work_record (id, owner_id, schedule_id, occurrence_start, status, work_date, content, version,
				                         created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?::date, '회의', 0, now(), now())""")
			.params(id, owner, scheduleId, Timestamp.from(Instant.parse(occurrenceStart)), status, workDate).update();
		return id.toString();
	}

	private long version(String schedule) throws Exception {
		return ((Number) JsonPath.read(send(ALICE, get("/api/worklog/schedules/" + schedule), "").andReturn().getResponse()
			.getContentAsString(), "$.version")).longValue();
	}

	private boolean exists(String id) {
		return jdbc.sql("SELECT count(*) FROM work_record WHERE id = ?").param(UUID.fromString(id)).query(Long.class)
			.single() > 0;
	}

	private ResultActions record(UUID owner, String body) throws Exception {
		return send(owner, post("/api/worklog/records"), body).andExpect(status().isCreated());
	}

	private ResultActions list(String query) throws Exception {
		return mvc.perform(get("/api/worklog/records?" + query).with(user(ALICE)));
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

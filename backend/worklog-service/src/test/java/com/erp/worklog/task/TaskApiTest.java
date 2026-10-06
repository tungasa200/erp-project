package com.erp.worklog.task;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.user.UserDataPurger;
import com.jayway.jsonpath.JsonPath;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 업무 API (P1-03, 목록 필터 P1-04, contracts/worklog.yaml). */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class TaskApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a2");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b2");

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@Autowired
	UserDataPurger purger;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM schedule").update(); // 일정이 업무를 가리킨다 (schedule.task_id)
		jdbc.sql("DELETE FROM task").update();
		jdbc.sql("DELETE FROM tag").update();
		jdbc.sql("DELETE FROM project").update();
	}

	@Test
	void createUsesDefaultsAndDoneSetsCompletedAt() throws Exception {
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"  보고서 작성 \"}")
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.title").value("보고서 작성"))
				.andExpect(jsonPath("$.status").value("TODO"))
				.andExpect(jsonPath("$.priority").value("NORMAL"))
				.andExpect(jsonPath("$.progress").value(0))
				.andExpect(jsonPath("$.tagIds.length()").value(0))
				.andExpect(jsonPath("$.completedAt").isEmpty())
				.andExpect(jsonPath("$.deletedAt").isEmpty())
				.andExpect(jsonPath("$.version").value(0));

		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"끝난 일\",\"status\":\"DONE\",\"progress\":100}")
				.andExpect(jsonPath("$.completedAt").isNotEmpty());
	}

	@Test
	void createValidatesFieldsAndReferences() throws Exception {
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"  \"}"), "title", "REQUIRED");
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{}"), "title", "REQUIRED");
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"progress\":15}"), "progress", "OUT_OF_RANGE");
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"status\":\"WAITING\"}"), "status", "INVALID_FORMAT");

		String bobProject = id(send(BOB, post("/api/worklog/projects"), "{\"name\":\"b\",\"color\":\"P1\"}"));
		String bobTag = id(send(BOB, post("/api/worklog/tags"), "{\"name\":\"b\"}"));
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"projectId\":\"" + bobProject + "\"}"),
				"projectId", "NOT_FOUND");
		expectFieldError(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"tagIds\":[\"" + bobTag + "\"]}"),
				"tagIds", "NOT_FOUND");
	}

	@Test
	void patchChangesOnlySentFieldsAndNullClears() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String tagA = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"a\"}"));
		String tagB = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"b\"}"));
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"dueDate\":\"2026-10-10\",\"projectId\":\""
				+ project + "\",\"tagIds\":[\"" + tagA + "\"],\"memo\":\"메모\"}"));

		// 보내지 않은 칸은 그대로
		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":0,\"priority\":\"HIGH\"}")
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.priority").value("HIGH"))
				.andExpect(jsonPath("$.dueDate").value("2026-10-10"))
				.andExpect(jsonPath("$.projectId").value(project))
				.andExpect(jsonPath("$.memo").value("메모"))
				.andExpect(jsonPath("$.version").value(1));

		// null은 비우기, tagIds는 통째로 교체
		send(ALICE, patch("/api/worklog/tasks/" + task),
				"{\"version\":1,\"dueDate\":null,\"projectId\":null,\"memo\":null,\"tagIds\":[\"" + tagB + "\"]}")
				.andExpect(jsonPath("$.dueDate").isEmpty())
				.andExpect(jsonPath("$.projectId").isEmpty())
				.andExpect(jsonPath("$.memo").isEmpty())
				.andExpect(jsonPath("$.tagIds", contains(tagB)))
				.andExpect(jsonPath("$.version").value(2));

		// 같은 값을 다시 보내면 version이 오르지 않는다
		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":2,\"priority\":\"HIGH\",\"tagIds\":[\"" + tagB + "\"]}")
				.andExpect(jsonPath("$.version").value(2));

		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":1,\"title\":\"늦은 저장\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"title\":\"x\"}")
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.errors[0].field").value("version"));
	}

	@Test
	void statusTransitionsSetAndClearCompletedAt() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"progress\":30}"));

		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":0,\"status\":\"DONE\"}")
				.andExpect(jsonPath("$.completedAt").isNotEmpty())
				.andExpect(jsonPath("$.progress").value(30)); // 진행률은 자동으로 바꾸지 않는다
		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":1,\"status\":\"ON_HOLD\"}")
				.andExpect(jsonPath("$.status").value("ON_HOLD"))
				.andExpect(jsonPath("$.completedAt").isEmpty());
	}

	@Test
	void deleteIsSoftIdempotentAndRestorable() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\"}"));

		mvc.perform(delete("/api/worklog/tasks/" + task).with(user(ALICE))).andExpect(status().isNoContent());
		mvc.perform(delete("/api/worklog/tasks/" + task).with(user(ALICE))).andExpect(status().isNoContent());
		mvc.perform(get("/api/worklog/tasks/" + task).with(user(ALICE)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.deletedAt").isNotEmpty());
		long version = ((Number) JsonPath.read(mvc.perform(get("/api/worklog/tasks/" + task).with(user(ALICE)))
				.andReturn().getResponse().getContentAsString(), "$.version")).longValue();
		send(ALICE, patch("/api/worklog/tasks/" + task), "{\"version\":" + version + ",\"title\":\"x\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("TASK_DELETED"));

		mvc.perform(get("/api/worklog/tasks").with(user(ALICE))).andExpect(jsonPath("$.items.length()").value(0));
		mvc.perform(get("/api/worklog/tasks?deleted=true").with(user(ALICE))).andExpect(jsonPath("$.items[0].id").value(task));

		mvc.perform(post("/api/worklog/tasks/" + task + "/restore").with(user(ALICE)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.deletedAt").isEmpty());
		mvc.perform(post("/api/worklog/tasks/" + task + "/restore").with(user(ALICE))).andExpect(status().isOk());
		mvc.perform(get("/api/worklog/tasks").with(user(ALICE))).andExpect(jsonPath("$.items.length()").value(1));
	}

	@Test
	void otherUsersTaskIsNotFound() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\"}"));

		mvc.perform(get("/api/worklog/tasks/" + task).with(user(BOB))).andExpect(status().isNotFound());
		send(BOB, patch("/api/worklog/tasks/" + task), "{\"version\":0,\"title\":\"x\"}").andExpect(status().isNotFound());
		mvc.perform(delete("/api/worklog/tasks/" + task).with(user(BOB))).andExpect(status().isNotFound());
		mvc.perform(get("/api/worklog/tasks").with(user(BOB))).andExpect(jsonPath("$.items.length()").value(0));
	}

	@Test
	void listSortsByDueWithNullsLastAndPagesWithCursor() throws Exception {
		String noDue1 = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"없음1\"}"));
		String late = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"늦음\",\"dueDate\":\"2026-10-20\"}"));
		String early = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"이름\",\"dueDate\":\"2026-10-10\"}"));
		String noDue2 = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"없음2\"}"));
		String sameDay = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"같은 날\",\"dueDate\":\"2026-10-10\"}"));

		assertThat(pageThrough("sort=due", 2)).containsExactly(early, sameDay, late, noDue1, noDue2);
		assertThat(pageThrough("sort=created", 2)).containsExactly(sameDay, noDue2, early, late, noDue1);
	}

	@Test
	void listFilters() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String archived = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"old\",\"color\":\"P2\"}"));
		String tag = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"회의\"}"));
		String inProject = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"회의록 100% 정리\",\"projectId\":\"" + project
				+ "\",\"tagIds\":[\"" + tag + "\"],\"dueDate\":\"2026-10-10\"}"));
		String inArchived = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"옛 일\",\"projectId\":\"" + archived + "\"}"));
		String done = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"끝\",\"status\":\"DONE\",\"dueDate\":\"2026-10-20\"}"));
		send(ALICE, patch("/api/worklog/projects/" + archived), "{\"version\":0,\"archived\":true}").andExpect(status().isOk());

		expectIds("", inProject, done);
		expectIds("projectId=" + archived, inArchived);
		expectIds("status=DONE&status=ON_HOLD", done);
		expectIds("tagId=" + tag, inProject);
		expectIds("dueFrom=2026-10-11", done);
		expectIds("dueTo=2026-10-10", inProject);
		// %는 와일드카드가 아니라 글자로 찾는다 (URL 템플릿은 %를 다시 인코딩하므로 param으로 보낸다)
		for (String q : new String[] { "100%", "%" }) {
			mvc.perform(get("/api/worklog/tasks").param("q", q).with(user(ALICE)))
					.andExpect(jsonPath("$.items[*].id", containsInAnyOrder(inProject)));
		}
		expectIds("completedSince=2099-01-01T00:00:00Z", inProject);
	}

	@Test
	void listRejectsBadParameters() throws Exception {
		mvc.perform(get("/api/worklog/tasks?cursor=bm9wZQ").with(user(ALICE)))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
		expectFieldError(mvc.perform(get("/api/worklog/tasks?projectId=abc").with(user(ALICE))), "projectId", "INVALID_FORMAT");
		expectFieldError(mvc.perform(get("/api/worklog/tasks?status=WAITING").with(user(ALICE))), "status", "INVALID_FORMAT");
		expectFieldError(mvc.perform(get("/api/worklog/tasks?limit=0").with(user(ALICE))), "limit", "OUT_OF_RANGE");
		expectFieldError(mvc.perform(get("/api/worklog/tasks?sort=title").with(user(ALICE))), "sort", "INVALID_FORMAT");
	}

	@Test
	void hasScheduleAndScheduledFilterFollowScheduleLinks() throws Exception {
		String placed = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"배치됨\"}"));
		String unplaced = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"안 배치됨\"}"
				).andExpect(jsonPath("$.hasSchedule").value(false)));
		// 반복 일정 두 개가 같은 업무를 가리켜도 연결 하나로 본다
		insertSchedule(placed, "FREQ=WEEKLY");
		insertSchedule(placed, null);

		mvc.perform(get("/api/worklog/tasks/" + placed).with(user(ALICE))).andExpect(jsonPath("$.hasSchedule").value(true));
		expectIds("scheduled=false", unplaced);
		expectIds("scheduled=true", placed);
		expectIds("", placed, unplaced);
		mvc.perform(get("/api/worklog/tasks").with(user(ALICE)))
				.andExpect(jsonPath("$.items[?(@.id == '" + placed + "')].hasSchedule").value(true));
		expectFieldError(mvc.perform(get("/api/worklog/tasks?scheduled=maybe").with(user(ALICE))), "scheduled", "INVALID_FORMAT");
	}

	@Test
	void purgeRemovesTasksProjectsAndTags() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String tag = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"t\"}"));
		send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"t\",\"projectId\":\"" + project + "\",\"tagIds\":[\"" + tag + "\"]}")
				.andExpect(status().isCreated());
		send(BOB, post("/api/worklog/tasks"), "{\"title\":\"남는 일\"}").andExpect(status().isCreated());

		purger.purge(ALICE);

		for (String table : new String[] { "task", "tag", "project" }) {
			assertThat(jdbc.sql("SELECT count(*) FROM " + table + " WHERE owner_id = ?").param(ALICE)
					.query(Long.class).single()).as(table).isZero();
		}
		assertThat(jdbc.sql("SELECT count(*) FROM task WHERE owner_id = ?").param(BOB).query(Long.class).single()).isOne();
	}

	private void insertSchedule(String taskId, String rrule) {
		jdbc.sql("""
						INSERT INTO schedule (id, owner_id, task_id, title, all_day, start_at, end_at, timezone, recurrence_rule,
						                      span_start, version, created_at, updated_at)
						VALUES (?, ?, ?, 's', false, now(), now() + interval '1 hour', 'Asia/Seoul', ?, now(), 0, now(), now())""")
				.params(UUID.randomUUID(), ALICE, UUID.fromString(taskId), rrule)
				.update();
	}

	private List<String> pageThrough(String query, int limit) throws Exception {
		List<String> ids = new ArrayList<>();
		String cursor = null;
		do {
			String url = "/api/worklog/tasks?" + query + "&limit=" + limit + (cursor == null ? "" : "&cursor=" + cursor);
			String body = mvc.perform(get(url).with(user(ALICE))).andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString();
			ids.addAll(JsonPath.read(body, "$.items[*].id"));
			cursor = JsonPath.read(body, "$.nextCursor");
		} while (cursor != null);
		return ids;
	}

	private void expectIds(String query, String... ids) throws Exception {
		mvc.perform(get("/api/worklog/tasks?" + query).with(user(ALICE)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.items[*].id", containsInAnyOrder((Object[]) ids)));
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

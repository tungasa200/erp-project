package com.erp.worklog.project;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 프로젝트·태그 API (P1-02, contracts/worklog.yaml). */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class ProjectTagApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a1");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b1");

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM task").update();
		jdbc.sql("DELETE FROM tag").update();
		jdbc.sql("DELETE FROM project").update();
	}

	@Test
	void projectCreateListAndArchive() throws Exception {
		String id = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"  사내 ERP  \",\"color\":\"P3\"}")
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.name").value("사내 ERP"))
				.andExpect(jsonPath("$.color").value("P3"))
				.andExpect(jsonPath("$.archived").value(false))
				.andExpect(jsonPath("$.taskCount").value(0))
				.andExpect(jsonPath("$.version").value(0)));

		send(ALICE, patch("/api/worklog/projects/" + id), "{\"version\":0,\"archived\":true}")
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.archived").value(true))
				.andExpect(jsonPath("$.archivedAt").isNotEmpty())
				.andExpect(jsonPath("$.version").value(1));

		mvc.perform(get("/api/worklog/projects").with(user(ALICE)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.items.length()").value(0));
		mvc.perform(get("/api/worklog/projects?includeArchived=true").with(user(ALICE)))
				.andExpect(jsonPath("$.items.length()").value(1))
				.andExpect(jsonPath("$.items[0].id").value(id));

		send(ALICE, patch("/api/worklog/projects/" + id), "{\"version\":1,\"archived\":false,\"color\":\"P8\"}")
				.andExpect(jsonPath("$.archived").value(false))
				.andExpect(jsonPath("$.archivedAt").isEmpty())
				.andExpect(jsonPath("$.color").value("P8"));
	}

	@Test
	void projectNameIsUniqueIgnoringCaseAndSpaces() throws Exception {
		send(ALICE, post("/api/worklog/projects"), "{\"name\":\"Alpha\",\"color\":\"P1\"}").andExpect(status().isCreated());
		String beta = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"Beta\",\"color\":\"P1\"}"));

		send(ALICE, post("/api/worklog/projects"), "{\"name\":\" alpha \",\"color\":\"P2\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
		send(ALICE, patch("/api/worklog/projects/" + beta), "{\"version\":0,\"name\":\"ALPHA\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
		// 자기 이름의 대소문자만 바꾸는 것은 된다
		send(ALICE, patch("/api/worklog/projects/" + beta), "{\"version\":0,\"name\":\"BETA\"}")
				.andExpect(status().isOk());
		// 다른 사용자는 같은 이름을 쓸 수 있다
		send(BOB, post("/api/worklog/projects"), "{\"name\":\"Alpha\",\"color\":\"P1\"}").andExpect(status().isCreated());
	}

	@Test
	void projectValidationVersionAndOwnership() throws Exception {
		send(ALICE, post("/api/worklog/projects"), "{\"name\":\"   \",\"color\":\"P1\"}")
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.errors[0].field").value("name"))
				.andExpect(jsonPath("$.errors[0].code").value("REQUIRED"));
		send(ALICE, post("/api/worklog/projects"), "{\"name\":\"x\",\"color\":\"P9\"}")
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.errors[0].field").value("color"))
				.andExpect(jsonPath("$.errors[0].code").value("INVALID_FORMAT"));

		String id = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"x\",\"color\":\"P1\"}"));
		send(ALICE, patch("/api/worklog/projects/" + id), "{\"version\":0,\"name\":\"y\"}").andExpect(status().isOk());
		send(ALICE, patch("/api/worklog/projects/" + id), "{\"version\":0,\"name\":\"z\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));

		mvc.perform(get("/api/worklog/projects/" + id).with(user(BOB)))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("NOT_FOUND"));
		send(BOB, patch("/api/worklog/projects/" + id), "{\"version\":1,\"name\":\"뺏기\"}").andExpect(status().isNotFound());
	}

	@Test
	void projectTaskCountAndTagUsageSkipDeletedTasks() throws Exception {
		String project = id(send(ALICE, post("/api/worklog/projects"), "{\"name\":\"p\",\"color\":\"P1\"}"));
		String tag = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"회의\"}"));
		UUID live = insertTask(project, null);
		UUID deleted = insertTask(project, "now()");
		tagTask(live, tag);
		tagTask(deleted, tag);

		mvc.perform(get("/api/worklog/projects/" + project).with(user(ALICE))).andExpect(jsonPath("$.taskCount").value(1));
		mvc.perform(get("/api/worklog/tags").with(user(ALICE))).andExpect(jsonPath("$.items[0].usageCount").value(1));
	}

	@Test
	void tagCreateIsGetOrCreate() throws Exception {
		String id = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"Review\"}")
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.usageCount").value(0)));

		send(ALICE, post("/api/worklog/tags"), "{\"name\":\"review\"}")
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(id))
				.andExpect(jsonPath("$.name").value("Review"));
		send(BOB, post("/api/worklog/tags"), "{\"name\":\"review\"}").andExpect(status().isCreated());

		for (String bad : new String[] { "a b", "#x", "" }) {
			send(ALICE, post("/api/worklog/tags"), "{\"name\":\"" + bad + "\"}")
					.andExpect(status().isBadRequest())
					.andExpect(jsonPath("$.errors[0].field").value("name"));
		}
	}

	@Test
	void tagRenameAndDelete() throws Exception {
		String a = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"a\"}"));
		String b = id(send(ALICE, post("/api/worklog/tags"), "{\"name\":\"b\"}"));

		send(ALICE, patch("/api/worklog/tags/" + b), "{\"version\":0,\"name\":\"A\"}")
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
		send(ALICE, patch("/api/worklog/tags/" + b), "{\"version\":0,\"name\":\"c\"}")
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("c"))
				.andExpect(jsonPath("$.version").value(1));
		send(ALICE, patch("/api/worklog/tags/" + b), "{\"version\":0,\"name\":\"d\"}")
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));

		UUID task = insertTask(null, null);
		tagTask(task, a);
		mvc.perform(delete("/api/worklog/tags/" + a).with(user(BOB))).andExpect(status().isNotFound());
		mvc.perform(delete("/api/worklog/tags/" + a).with(user(ALICE))).andExpect(status().isNoContent());

		assertThat(jdbc.sql("SELECT count(*) FROM task_tag").query(Long.class).single()).isZero();
		mvc.perform(get("/api/worklog/tags").with(user(ALICE)))
				.andExpect(jsonPath("$.items.length()").value(1))
				.andExpect(jsonPath("$.items[0].name").value("c"));
	}

	private ResultActions send(UUID owner, MockHttpServletRequestBuilder request, String body) throws Exception {
		return mvc.perform(request.with(user(owner)).contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private static String id(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
	}

	private UUID insertTask(String projectId, String deletedAt) {
		UUID id = UUID.randomUUID();
		jdbc.sql("INSERT INTO task (id, owner_id, project_id, title, status, priority, progress, deleted_at, version, created_at, updated_at) "
						+ "VALUES (?, ?, ?, 't', 'TODO', 'NORMAL', 0, " + (deletedAt == null ? "NULL" : deletedAt) + ", 0, now(), now())")
				.params(id, ALICE, projectId == null ? null : UUID.fromString(projectId))
				.update();
		return id;
	}

	private void tagTask(UUID taskId, String tagId) {
		jdbc.sql("INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)").params(taskId, UUID.fromString(tagId)).update();
	}

	private static RequestPostProcessor user(UUID id) {
		return jwt().jwt(j -> j.subject(id.toString()));
	}
}

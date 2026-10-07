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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 타이머 (P2-06, contracts/worklog.yaml timer)와 경계값 (P2-09: 1분·24시간·동시 1개).
 * 시작 시각 = 2026-10-07(수) 12:00 KST. ALICE는 Asia/Seoul이고 시간 기록 옵션을 켰다.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, TimerApiTest.Clocks.class })
class TimerApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000000a6");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-0000000000b6");
	static final Instant NOW = Instant.parse("2026-10-07T03:00:00Z");

	/** 테스트가 시각을 옮길 수 있는 시계. */
	static class MovableClock extends Clock {
		Instant now = NOW;

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return now;
		}
	}

	@TestConfiguration
	static class Clocks {
		@Bean
		@Primary
		MovableClock movableClock() {
			return new MovableClock();
		}
	}

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcClient jdbc;
	@Autowired
	MovableClock clock;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		cleanUp();
		clock.now = NOW;
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id IN (?, ?)").params(ALICE, BOB).update();
		for (UUID u : new UUID[] { ALICE, BOB }) {
			jdbc.sql("""
					INSERT INTO user_snapshot (user_id, timezone, week_start, work_days, last_seq, synced_at)
					VALUES (?, 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(u).update();
		}
		trackTime(ALICE, true);
	}

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_record").update();
		jdbc.sql("DELETE FROM schedule").update();
		jdbc.sql("DELETE FROM task WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
		jdbc.sql("DELETE FROM user_setting WHERE owner_id IN (?, ?)").params(ALICE, BOB).update();
	}

	@Test
	void 옵션이_꺼져_있으면_시작만_막고_조회와_정지는_된다() throws Exception {
		timer(BOB).andExpect(status().isOk()).andExpect(jsonPath("$.running").isEmpty());
		start(BOB, "{\"content\":\"t\"}")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("TIME_TRACKING_DISABLED"));
		stop(BOB).andExpect(status().isOk()).andExpect(jsonPath("$.stopped").isEmpty()).andExpect(jsonPath("$.next").isEmpty());

		// 켠 채 시작한 타이머는 옵션을 꺼도 남고, 멈출 수 있다
		start(ALICE, "{\"content\":\"t\"}").andExpect(status().isOk());
		trackTime(ALICE, false);
		timer(ALICE).andExpect(jsonPath("$.running.content").value("t"));
		later(Duration.ofMinutes(5));
		stop(ALICE).andExpect(jsonPath("$.stopped.record.durationMin").value(5));
	}

	@Test
	void 시작하면_실행_중인_타이머를_멈추고_새로_시작한다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"견적서\"}"));
		String first = JsonPath.read(start(ALICE, "{\"content\":\"  메일 정리 \"}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.running.content").value("메일 정리"))
			.andExpect(jsonPath("$.running.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.running.workDate").value("2026-10-07"))
			.andExpect(jsonPath("$.running.startAt").value("2026-10-07T03:00:00Z"))
			.andExpect(jsonPath("$.running.endAt").isEmpty())
			.andExpect(jsonPath("$.stopped").isEmpty())
			.andReturn().getResponse().getContentAsString(), "$.running.id");
		timer(ALICE).andExpect(jsonPath("$.running.id").value(first));
		timer(BOB).andExpect(jsonPath("$.running").isEmpty());

		later(Duration.ofMinutes(30));
		start(ALICE, "{\"taskId\":\"" + task + "\"}")
			.andExpect(jsonPath("$.running.content").value("견적서"))
			.andExpect(jsonPath("$.running.taskId").value(task))
			.andExpect(jsonPath("$.stopped.record.id").value(first))
			.andExpect(jsonPath("$.stopped.record.endAt").value("2026-10-07T03:30:00Z"))
			.andExpect(jsonPath("$.stopped.record.durationMin").value(30))
			.andExpect(jsonPath("$.stopped.discarded").value(false))
			.andExpect(jsonPath("$.stopped.capped").value(false));
		assertThat(runningCount(ALICE)).isEqualTo(1);

		// 자정을 넘겨 시작하면 그날(사용자 시간대) 날짜다: 15:30Z = 10-08 00:30 KST
		clock.now = Instant.parse("2026-10-07T15:30:00Z");
		start(ALICE, "{\"content\":\"야간\"}").andExpect(jsonPath("$.running.workDate").value("2026-10-08"));
	}

	@Test
	void 정지_경계값_1분_미만은_버리고_24시간을_넘으면_자른다() throws Exception {
		// 59초: 버린다(하드 삭제)
		String id = runningId(start(ALICE, "{\"content\":\"실수\"}"));
		later(Duration.ofSeconds(59));
		stop(ALICE)
			.andExpect(jsonPath("$.stopped.discarded").value(true))
			.andExpect(jsonPath("$.stopped.record.id").value(id));
		send(ALICE, get("/api/worklog/records/" + id), "").andExpect(status().isNotFound());

		// 정확히 1분: 남긴다
		start(ALICE, "{\"content\":\"1분\"}");
		later(Duration.ofMinutes(1));
		stop(ALICE).andExpect(jsonPath("$.stopped.discarded").value(false)).andExpect(jsonPath("$.stopped.record.durationMin").value(1));

		// 정확히 24시간: 자르지 않는다
		start(ALICE, "{\"content\":\"24시간\"}");
		later(Duration.ofHours(24));
		stop(ALICE).andExpect(jsonPath("$.stopped.capped").value(false)).andExpect(jsonPath("$.stopped.record.durationMin").value(1440));

		// 24시간 1초: startAt+24시간으로 멈춘다
		String startAt = clock.now.toString();
		start(ALICE, "{\"content\":\"잊은 타이머\"}");
		later(Duration.ofHours(24).plusSeconds(1));
		stop(ALICE)
			.andExpect(jsonPath("$.stopped.capped").value(true))
			.andExpect(jsonPath("$.stopped.record.endAt").value(Instant.parse(startAt).plus(Duration.ofHours(24)).toString()))
			.andExpect(jsonPath("$.stopped.record.durationMin").value(1440));
		timer(ALICE).andExpect(jsonPath("$.running").isEmpty());
	}

	@Test
	void 계획_회차를_가져가고_이어달리기를_제안한다() throws Exception {
		String task = id(send(ALICE, post("/api/worklog/tasks"), "{\"title\":\"스탠드업\"}"));
		// 09:00–10:00 KST는 끝났고 확인 대기가 생긴다, 13:00–14:00 KST는 아직, 11:30–12:30 KST는 진행 중(업무 없음)
		String ended = schedule(ALICE, "아침 회의", "2026-10-07T00:00:00Z", "2026-10-07T01:00:00Z", task);
		String afternoon = schedule(ALICE, "오후 회의", "2026-10-07T04:00:00Z", "2026-10-07T05:00:00Z", task);
		String now = schedule(ALICE, "점심 정리", "2026-10-07T02:30:00Z", "2026-10-07T03:30:00Z", null);
		String pending = JsonPath.read(send(ALICE, get("/api/worklog/records/pending"), "")
			.andReturn().getResponse().getContentAsString(), "$.items[0].id");

		// 진행 중인 회차가 먼저다
		stop(ALICE).andExpect(jsonPath("$.next.scheduleId").value(now)).andExpect(jsonPath("$.next.taskId").isEmpty());
		start(ALICE, plan(now, "2026-10-07T02:30:00Z"))
			.andExpect(jsonPath("$.running.content").value("점심 정리"))
			.andExpect(jsonPath("$.running.scheduleId").value(now))
			.andExpect(jsonPath("$.running.occurrenceStart").value("2026-10-07T02:30:00Z"));
		later(Duration.ofMinutes(20));
		// 기록이 생긴 회차는 다시 제안하지 않는다
		stop(ALICE).andExpect(jsonPath("$.next.scheduleId").value(afternoon));

		// 확인 대기가 있는 회차는 그 기록을 가져간다 (새 기록 없음)
		start(ALICE, plan(ended, "2026-10-07T00:00:00Z"))
			.andExpect(jsonPath("$.running.id").value(pending))
			.andExpect(jsonPath("$.running.status").value("CONFIRMED"))
			.andExpect(jsonPath("$.running.taskId").value(task));
		// 1분이 안 돼 멈추면 확인 대기로 되돌린다
		later(Duration.ofSeconds(30));
		stop(ALICE)
			.andExpect(jsonPath("$.stopped.discarded").value(true))
			.andExpect(jsonPath("$.stopped.record.status").value("PENDING"))
			.andExpect(jsonPath("$.stopped.record.startAt").isEmpty());
		send(ALICE, get("/api/worklog/records/" + pending), "").andExpect(jsonPath("$.status").value("PENDING"));

		// 처리한 회차는 409, 실행 중인 타이머는 그대로다
		start(ALICE, "{\"content\":\"딴 일\"}");
		start(ALICE, plan(now, "2026-10-07T02:30:00Z"))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALREADY_RECORDED"));
		timer(ALICE).andExpect(jsonPath("$.running.content").value("딴 일"));
		// 없는 회차·남의 일정은 404
		start(ALICE, plan(now, "2026-10-07T02:31:00Z")).andExpect(status().isNotFound());
		String bobs = schedule(BOB, "남의 회의", "2026-10-07T04:00:00Z", "2026-10-07T05:00:00Z", null);
		start(ALICE, plan(bobs, "2026-10-07T04:00:00Z")).andExpect(status().isNotFound());
	}

	@Test
	void 입력_규칙() throws Exception {
		expectFieldError(start(ALICE, "{}"), "content", "REQUIRED");
		expectFieldError(start(ALICE, "{\"content\":\"  \"}"), "content", "REQUIRED");
		expectFieldError(start(ALICE, "{\"scheduleId\":\"" + UUID.randomUUID() + "\"}"), "occurrenceStart", "INVALID_FORMAT");
		String bobTask = id(send(BOB, post("/api/worklog/tasks"), "{\"title\":\"b\"}"));
		expectFieldError(start(ALICE, "{\"taskId\":\"" + bobTask + "\"}"), "taskId", "NOT_FOUND");
		timer(ALICE).andExpect(jsonPath("$.running").isEmpty());
	}

	@Test
	void 실행_중인_타이머는_끝_없이_고치고_endAt을_넣으면_멈춘다() throws Exception {
		String id = runningId(start(ALICE, "{\"content\":\"t\"}"));
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":0,\"content\":\"고침\",\"startAt\":\"2026-10-07T02:50:00Z\"}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.content").value("고침"))
			.andExpect(jsonPath("$.endAt").isEmpty());
		send(ALICE, patch("/api/worklog/records/" + id), "{\"version\":1,\"endAt\":\"2026-10-07T03:00:00Z\"}")
			.andExpect(jsonPath("$.durationMin").value(10));
		timer(ALICE).andExpect(jsonPath("$.running").isEmpty());
	}

	@Test
	void 동시_1개_보관한_타이머는_다른_타이머가_돌면_복원하지_않고_DB도_둘째를_막는다() throws Exception {
		String first = runningId(start(ALICE, "{\"content\":\"보관할 타이머\"}"));
		send(ALICE, delete("/api/worklog/records/" + first), "").andExpect(status().isNoContent());
		timer(ALICE).andExpect(jsonPath("$.running").isEmpty());
		start(ALICE, "{\"content\":\"새 타이머\"}").andExpect(jsonPath("$.stopped").isEmpty());
		send(ALICE, post("/api/worklog/records/" + first + "/restore"), "")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("TIMER_RUNNING"));

		assertThatThrownBy(() -> jdbc.sql("""
				INSERT INTO work_record (id, owner_id, status, work_date, content, start_at, version, created_at, updated_at)
				VALUES (?, ?, 'CONFIRMED', '2026-10-07', 'x', now(), 0, now(), now())""")
			.params(UUID.randomUUID(), ALICE).update()).isInstanceOf(DataIntegrityViolationException.class);

		later(Duration.ofMinutes(5));
		stop(ALICE);
		send(ALICE, post("/api/worklog/records/" + first + "/restore"), "").andExpect(status().isOk());
		timer(ALICE).andExpect(jsonPath("$.running.id").value(first));
	}

	@Test
	void 옵션을_껐다_켜도_기록의_시간과_집계는_그대로다() throws Exception {
		String typed = id(send(ALICE, post("/api/worklog/records"),
				"{\"content\":\"직접\",\"startAt\":\"2026-10-07T00:00:00Z\",\"endAt\":\"2026-10-07T00:40:00Z\"}")
			.andExpect(status().isCreated()));
		start(ALICE, "{\"content\":\"타이머\"}").andExpect(status().isOk());
		later(Duration.ofMinutes(30));
		stop(ALICE).andExpect(jsonPath("$.stopped.record.durationMin").value(30));

		// 끄면 시작만 막히고, 시간과 무관한 수정도 시간 칸을 지우지 않으며 집계도 그대로다
		send(ALICE, patch("/api/worklog/me/settings"), "{\"version\":0,\"timeTrackingEnabled\":false}")
			.andExpect(status().isOk());
		send(ALICE, patch("/api/worklog/records/" + typed), "{\"version\":0,\"content\":\"내용만\"}")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.startAt").value("2026-10-07T00:00:00Z"))
			.andExpect(jsonPath("$.endAt").value("2026-10-07T00:40:00Z"))
			.andExpect(jsonPath("$.durationMin").value(40));
		send(ALICE, get("/api/worklog/records/time-summary?from=2026-10-07&to=2026-10-07"), "")
			.andExpect(jsonPath("$.totalMin").value(70));

		// 다시 켜도 그대로
		send(ALICE, patch("/api/worklog/me/settings"), "{\"version\":1,\"timeTrackingEnabled\":true}")
			.andExpect(status().isOk());
		send(ALICE, get("/api/worklog/records?from=2026-10-07&to=2026-10-07"), "")
			.andExpect(jsonPath("$.items.length()").value(2))
			.andExpect(jsonPath("$.items[*].durationMin").value(containsInAnyOrder(40, 30)));
		send(ALICE, get("/api/worklog/records/time-summary?from=2026-10-07&to=2026-10-07"), "")
			.andExpect(jsonPath("$.totalMin").value(70));
	}

	private void later(Duration d) {
		clock.now = clock.now.plus(d);
	}

	private void trackTime(UUID owner, boolean on) {
		jdbc.sql("""
				INSERT INTO user_setting (owner_id, time_tracking_enabled, work_hours_start, work_hours_end, daily_close_time,
				                          version, created_at, updated_at)
				VALUES (?, ?, '09:00', '18:00', '18:00', 0, now(), now())
				ON CONFLICT (owner_id) DO UPDATE SET time_tracking_enabled = EXCLUDED.time_tracking_enabled""")
			.params(owner, on).update();
	}

	private long runningCount(UUID owner) {
		return jdbc.sql("SELECT count(*) FROM work_record WHERE owner_id = ? AND start_at IS NOT NULL AND end_at IS NULL")
			.params(owner).query(Long.class).single();
	}

	private String schedule(UUID owner, String title, String startAt, String endAt, String task) throws Exception {
		return id(send(owner, post("/api/worklog/schedules"), """
				{"title":"%s","allDay":false,"startAt":"%s","endAt":"%s"%s}""".formatted(title, startAt, endAt,
				task == null ? "" : ",\"taskId\":\"" + task + "\"")));
	}

	private static String plan(String scheduleId, String occurrenceStart) {
		return "{\"scheduleId\":\"" + scheduleId + "\",\"occurrenceStart\":\"" + occurrenceStart + "\"}";
	}

	private ResultActions timer(UUID owner) throws Exception {
		return send(owner, get("/api/worklog/timer"), "");
	}

	private ResultActions start(UUID owner, String body) throws Exception {
		return send(owner, post("/api/worklog/timer/start"), body);
	}

	private ResultActions stop(UUID owner) throws Exception {
		return send(owner, post("/api/worklog/timer/stop"), "");
	}

	private static String runningId(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.running.id");
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

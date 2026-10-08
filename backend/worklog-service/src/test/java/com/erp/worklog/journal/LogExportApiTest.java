package com.erp.worklog.journal;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.jayway.jsonpath.JsonPath;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openpdf.text.pdf.PdfReader;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.io.ByteArrayInputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 파일 내보내기 (P3-10 EXP-02~04, AUTH-08). 지금 = 2026-10-07(수) 15:00 KST. 시간 기록 옵션을 켜 소요시간 표까지 그린다. */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import({ PostgresTestConfig.class, LogExportApiTest.FixedClock.class })
class LogExportApiTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-0000000003a8");
	static final Instant NOW = Instant.parse("2026-10-07T06:00:00Z");
	static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
	void reset() throws Exception {
		cleanUp();
		profile("홍/길:동");
		jdbc.sql("""
				INSERT INTO user_setting (owner_id, time_tracking_enabled, work_hours_start, work_hours_end, daily_close_time, version,
				    created_at, updated_at)
				VALUES (?, true, '09:00', '18:00', '18:00', 0, now(), now())""").params(ALICE).update();

		String project = id(send(post("/api/worklog/projects"), "{\"name\":\"ERP\",\"color\":\"P1\"}"));
		String api = id(send(post("/api/worklog/tasks"), "{\"title\":\"API\",\"projectId\":\"" + project + "\"}"));
		record("{\"content\":\"설계 ✓ 검토\",\"workDate\":\"2026-10-06\",\"taskId\":\"" + api
				+ "\",\"result\":\"초안\\n둘째 줄\",\"outcome\":\"IN_PROGRESS\",\"progress\":30,"
				+ "\"startAt\":\"2026-10-06T01:00:00Z\",\"endAt\":\"2026-10-06T02:30:00Z\"}");
		send(post("/api/worklog/logs/daily/2026-10-06/close"), "{\"version\":0,\"carryOverTaskIds\":[],\"issue\":\"서버 점검\"}")
			.andExpect(status().isOk());
		record("{\"content\":\"구현\",\"workDate\":\"2026-10-07\",\"taskId\":\"" + api + "\",\"outcome\":\"DONE\"}");
		record("{\"content\":\"메모\",\"workDate\":\"2026-10-07\"}");
	}

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM work_log WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM work_record WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM task WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM project WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM user_setting WHERE owner_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM email_verified_user WHERE user_id = ?").params(ALICE).update();
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id = ?").params(ALICE).update();
	}

	@Test
	void 이메일_인증_전이면_403_확인하지_못하면_503() throws Exception {
		when(identity.emailVerified(any())).thenReturn(false);
		send(get("/api/worklog/logs/daily/2026-10-07/export?format=PDF"), "").andExpect(status().isForbidden())
			.andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));

		when(identity.emailVerified(any())).thenThrow(new IdentityClient.IdentityUnavailableException("down"));
		send(get("/api/worklog/records/export?from=2026-10-01&to=2026-10-07"), "").andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.code").value("IDENTITY_UNAVAILABLE"));
		assertThat(jdbc.sql("SELECT count(*) FROM email_verified_user WHERE user_id = ?").param(ALICE).query(Long.class).single())
			.isZero();
	}

	@Test
	void 인증은_한_번_확인하면_기억한다() throws Exception {
		when(identity.emailVerified(any())).thenReturn(true);
		send(get("/api/worklog/logs/daily/2026-10-07/export?format=PDF"), "").andExpect(status().isOk());
		send(get("/api/worklog/logs/daily/2026-10-07/export?format=DOCX"), "").andExpect(status().isOk());
		verify(identity, times(1)).emailVerified(any());
	}

	@Test
	void 세_형식을_일간_주간_월간으로_만든다() throws Exception {
		when(identity.emailVerified(any())).thenReturn(true);
		for (String path : new String[] { "daily/2026-10-06", "daily/2026-10-07", "weekly/2026-10-05", "monthly/2026-10-01" }) {
			String start = path.substring(path.indexOf('/') + 1);

			byte[] pdf = export(path, "PDF", MediaType.APPLICATION_PDF_VALUE, "worklog_" + start + ".pdf",
					"업무일지_" + start + "_홍_길_동.pdf");
			PdfReader reader = new PdfReader(pdf);
			assertThat(reader.getNumberOfPages()).isPositive();
			reader.close();

			byte[] docx = export(path, "DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"worklog_" + start + ".docx", "업무일지_" + start + "_홍_길_동.docx");
			try (XWPFDocument doc = new XWPFDocument(new ByteArrayInputStream(docx))) {
				assertThat(doc.getStyles().getStyleWithName("업무일지 구분")).isNotNull();
				assertThat(doc.getTables()).hasSizeGreaterThanOrEqualTo(3);
				assertThat(doc.getFooterList()).hasSize(1);
			}

			byte[] xlsx = export(path, "XLSX", XLSX, "worklog_" + start + ".xlsx", "업무일지_" + start + "_홍_길_동.xlsx");
			try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(xlsx))) {
				assertThat(wb.getSheetName(0)).isEqualTo("업무일지");
				assertThat(wb.getSheetName(1)).isEqualTo("기록");
				Sheet log = wb.getSheetAt(0);
				assertThat(log.getColumnWidth(2)).isEqualTo(30 * 256);
				assertThat(log.getRow(0).getCell(0).getStringCellValue()).contains("업무일지");
			}
		}
	}

	@Test
	void 기간_기록_Excel은_세_상태를_한_행씩_담고_범위를_검사한다() throws Exception {
		when(identity.emailVerified(any())).thenReturn(true);
		send(get("/api/worklog/records/export?from=2026-10-07&to=2026-10-01"), "").andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errors[0].field").value("to"));
		send(get("/api/worklog/records/export?from=2025-01-01&to=2026-10-07"), "").andExpect(status().isBadRequest());
		send(get("/api/worklog/logs/daily/2026-10-07/export?format=HWP"), "").andExpect(status().isBadRequest());

		profile("");
		MockHttpServletResponse res = send(get("/api/worklog/records/export?from=2026-10-01&to=2026-10-07"), "")
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, disposition("records_2026-10-01_2026-10-07.xlsx",
					"업무기록_2026-10-01_2026-10-07.xlsx")))
			.andReturn().getResponse();
		try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(res.getContentAsByteArray()))) {
			assertThat(wb.getNumberOfSheets()).isEqualTo(1);
			Sheet s = wb.getSheet("기록");
			assertThat(s.getLastRowNum()).isEqualTo(3);
			assertThat(s.getRow(0).getCell(4).getStringCellValue()).isEqualTo("상태");
			assertThat(s.getRow(1).getCell(1).getStringCellValue()).isEqualTo("설계 ✓ 검토");
			assertThat(s.getRow(1).getCell(4).getStringCellValue()).isEqualTo("확정");
			assertThat(s.getRow(1).getCell(7).getNumericCellValue()).isEqualTo(30);
			assertThat(s.getRow(1).getCell(10).getNumericCellValue()).isEqualTo(90);
			assertThat(s.getRow(2).getCell(6).getStringCellValue()).isEqualTo("완료");
		}
	}

	private byte[] export(String path, String format, String type, String ascii, String name) throws Exception {
		return send(get("/api/worklog/logs/" + path + "/export?format=" + format), "")
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.CONTENT_TYPE, type))
			.andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, disposition(ascii, name)))
			.andReturn().getResponse().getContentAsByteArray();
	}

	private static String disposition(String ascii, String name) {
		return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''"
				+ URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
	}

	private void profile(String name) {
		jdbc.sql("DELETE FROM user_snapshot WHERE user_id = ?").params(ALICE).update();
		jdbc.sql("""
				INSERT INTO user_snapshot (user_id, name, organization, position, timezone, week_start, work_days, last_seq, synced_at)
				VALUES (?, ?, '개발팀', '', 'Asia/Seoul', 'MONDAY', 31, 0, now())""").params(ALICE, name).update();
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

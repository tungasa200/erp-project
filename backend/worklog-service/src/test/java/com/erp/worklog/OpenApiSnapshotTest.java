package com.erp.worklog;

import com.erp.common.test.OpenApiSnapshot;
import com.erp.worklog.identity.IdentityClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * springdoc 출력이 contracts/generated/worklog.json과 같은지 확인한다.
 * 갱신: ./gradlew :worklog-service:openApiSnapshot
 * 운영에서는 /v3/api-docs를 열지 않으므로(SecurityConfig denyAll) 보안 필터 없이 읽는다.
 */
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc(addFilters = false)
@Import(PostgresTestConfig.class)
class OpenApiSnapshotTest {

	@Autowired
	MockMvc mvc;
	@MockitoBean
	IdentityClient identity;

	@Test
	void 명세_스냅샷이_현재_API와_같다() throws Exception {
		String apiDocs = mvc.perform(get("/v3/api-docs"))
				.andExpect(status().isOk())
				.andReturn()
				.getResponse()
				.getContentAsString();
		OpenApiSnapshot.verifyOrWrite(apiDocs);
	}
}

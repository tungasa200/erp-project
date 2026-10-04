package com.erp.identity;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.erp.common.test.OpenApiSnapshot;

/**
 * springdoc 출력이 contracts/generated/identity.json과 같은지 확인한다.
 * 갱신: ./gradlew :identity-service:openApiSnapshot
 */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiSnapshotTest {

	@Autowired
	MockMvc mvc;

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

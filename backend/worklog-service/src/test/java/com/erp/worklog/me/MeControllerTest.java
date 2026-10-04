package com.erp.worklog.me;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.user.DeletedUserRepository;
import com.erp.worklog.user.Profile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** GET /api/worklog/me: 사본 즉시 조회, 탈퇴 사용자 거부, identity 장애 (P0-11, contracts/worklog.yaml). */
// common이 스케줄링을 켜므로 주기 작업이 테스트 중에 돌지 않게 미룬다. 작업은 테스트에서 직접 부른다.
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@AutoConfigureMockMvc
@Import(PostgresTestConfig.class)
class MeControllerTest {

	static final UUID USER = UUID.fromString("0192f3a0-0000-7000-8000-0000000000aa");

	@Autowired
	MockMvc mvc;
	@Autowired
	DeletedUserRepository deletedUsers;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM user_snapshot").update();
		jdbc.sql("DELETE FROM deleted_user").update();
	}

	@Test
	void missingSnapshotIsFetchedFromIdentityAndStored() throws Exception {
		when(identity.me("user-token")).thenReturn(new Profile("앨리스", "개발팀", null, "Asia/Seoul", "MONDAY", 31));

		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.userId").value(USER.toString()))
				.andExpect(jsonPath("$.profile.name").value("앨리스"))
				.andExpect(jsonPath("$.profile.workDays").value(31))
				.andExpect(jsonPath("$.settings.timeTrackingEnabled").value(false));

		// 두 번째 요청은 저장된 사본을 쓴다
		mvc.perform(get("/api/worklog/me").with(userToken())).andExpect(status().isOk());
		verify(identity, org.mockito.Mockito.times(1)).me(anyString());
	}

	@Test
	void identityFailureWithoutSnapshotIs503() throws Exception {
		when(identity.me(anyString())).thenThrow(new IdentityClient.IdentityUnavailableException(new RuntimeException("down")));

		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("PROFILE_UNAVAILABLE"));
	}

	@Test
	void deletedUserIsRejectedBeforeReachingController() throws Exception {
		deletedUsers.add(USER);

		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("USER_DELETED"));
		verify(identity, never()).me(anyString());
	}

	@Test
	void identityReportingDeletedUserIsRejected() throws Exception {
		when(identity.me(anyString())).thenThrow(new IdentityClient.UserDeletedException());

		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("USER_DELETED"));
	}

	private static org.springframework.test.web.servlet.request.RequestPostProcessor userToken() {
		return jwt().jwt(j -> j.subject(USER.toString()).tokenValue("user-token"));
	}
}

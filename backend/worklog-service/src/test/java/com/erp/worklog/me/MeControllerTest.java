package com.erp.worklog.me;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.user.DeletedUserRepository;
import com.erp.worklog.user.Profile;
import com.erp.worklog.user.UserDataPurger;
import com.erp.worklog.user.UserSnapshotRepository;
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
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * /api/worklog/me: 사본 즉시 조회, 탈퇴 사용자 거부, identity 장애 (P0-11),
 * 프로필 즉시 갱신과 worklog 설정 수정 (P1-01, contracts/worklog.yaml).
 */
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
	@Autowired
	UserSnapshotRepository snapshots;
	@Autowired
	UserDataPurger purger;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM user_snapshot").update();
		jdbc.sql("DELETE FROM deleted_user").update();
		jdbc.sql("DELETE FROM user_setting").update();
	}

	@Test
	void missingSnapshotIsFetchedFromIdentityAndStored() throws Exception {
		when(identity.me("user-token")).thenReturn(profile("앨리스", 0));

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

	@Test
	void settingsDefaultToScreenDefaultsWithVersionZero() throws Exception {
		snapshots.insertIfAbsent(USER, profile("앨리스", 0));

		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.settings.timeTrackingEnabled").value(false))
				.andExpect(jsonPath("$.settings.workHoursStart").value("09:00"))
				.andExpect(jsonPath("$.settings.workHoursEnd").value("18:00"))
				.andExpect(jsonPath("$.settings.dailyCloseTime").value("18:00"))
				.andExpect(jsonPath("$.settings.version").value(0));
	}

	@Test
	void settingsPatchChangesOnlySentFieldsAndChecksVersion() throws Exception {
		// 첫 저장은 행이 없으므로 version 0, 기본값 위에 보낸 칸만 반영
		mvc.perform(patchSettings("{\"version\":0,\"workHoursStart\":\"08:30\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.workHoursStart").value("08:30"))
				.andExpect(jsonPath("$.workHoursEnd").value("18:00"))
				.andExpect(jsonPath("$.version").value(0));

		mvc.perform(patchSettings("{\"version\":0,\"timeTrackingEnabled\":true}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.timeTrackingEnabled").value(true))
				.andExpect(jsonPath("$.workHoursStart").value("08:30"))
				.andExpect(jsonPath("$.version").value(1));

		// 다른 탭이 예전 version으로 저장
		mvc.perform(patchSettings("{\"version\":0,\"dailyCloseTime\":\"19:00\"}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
		snapshots.insertIfAbsent(USER, profile("앨리스", 0));
		mvc.perform(get("/api/worklog/me").with(userToken()))
				.andExpect(jsonPath("$.settings.dailyCloseTime").value("18:00"))
				.andExpect(jsonPath("$.settings.version").value(1));
	}

	@Test
	void firstSettingsSaveWithNonZeroVersionIsConflict() throws Exception {
		mvc.perform(patchSettings("{\"version\":3,\"timeTrackingEnabled\":true}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
	}

	@Test
	void workHoursEndMustBeAfterStart() throws Exception {
		mvc.perform(patchSettings("{\"version\":0,\"workHoursEnd\":\"09:00\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.errors[0].field").value("workHoursEnd"))
				.andExpect(jsonPath("$.errors[0].code").value("INVALID_ORDER"));
		assertThat(jdbc.sql("SELECT count(*) FROM user_setting").query(Long.class).single()).isZero();
	}

	@Test
	void settingsPatchValidatesFormatAndVersion() throws Exception {
		mvc.perform(patchSettings("{\"version\":0,\"dailyCloseTime\":\"24:00\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.errors[0].field").value("dailyCloseTime"))
				.andExpect(jsonPath("$.errors[0].code").value("INVALID_FORMAT"));
		mvc.perform(patchSettings("{\"timeTrackingEnabled\":true}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.errors[0].field").value("version"))
				.andExpect(jsonPath("$.errors[0].code").value("REQUIRED"));
	}

	@Test
	void refreshReplacesSnapshotOnlyWithNewerProfileVersion() throws Exception {
		snapshots.upsert(USER, profile("예전 이름", 1), 10);
		when(identity.me("user-token")).thenReturn(profile("새 이름", 2));

		mvc.perform(post("/api/worklog/me/profile/refresh").with(userToken()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.profile.name").value("새 이름"))
				.andExpect(jsonPath("$.settings.version").value(0));

		// 뒤늦게 처리된 예전 피드 이벤트는 새 값을 되돌리지 않는다
		snapshots.upsert(USER, profile("예전 이름", 1), 11);
		assertThat(snapshots.find(USER)).hasValueSatisfying(s -> assertThat(s.profile().name()).isEqualTo("새 이름"));

		// 피드가 먼저 더 새 값을 넣었으면 즉시 갱신이 그것을 덮지 않는다
		snapshots.upsert(USER, profile("피드 값", 4), 12);
		mvc.perform(post("/api/worklog/me/profile/refresh").with(userToken()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.profile.name").value("피드 값"));
	}

	@Test
	void refreshWithIdentityDownIs503() throws Exception {
		when(identity.me(anyString())).thenThrow(new IdentityClient.IdentityUnavailableException(new RuntimeException("down")));

		mvc.perform(post("/api/worklog/me/profile/refresh").with(userToken()))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("PROFILE_UNAVAILABLE"));
	}

	@Test
	void purgeRemovesSettings() throws Exception {
		mvc.perform(patchSettings("{\"version\":0,\"timeTrackingEnabled\":true}")).andExpect(status().isOk());

		purger.purge(USER);

		assertThat(jdbc.sql("SELECT count(*) FROM user_setting").query(Long.class).single()).isZero();
	}

	private static org.springframework.test.web.servlet.RequestBuilder patchSettings(String body) {
		return patch("/api/worklog/me/settings").with(userToken())
				.contentType(org.springframework.http.MediaType.APPLICATION_JSON)
				.content(body);
	}

	private static Profile profile(String name, long version) {
		return new Profile(name, "개발팀", null, "Asia/Seoul", "MONDAY", 31, version);
	}

	private static org.springframework.test.web.servlet.request.RequestPostProcessor userToken() {
		return jwt().jwt(j -> j.subject(USER.toString()).tokenValue("user-token"));
	}
}

package com.erp.worklog.user;

import com.erp.worklog.PostgresTestConfig;
import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.identity.IdentityClient.DeletedUserItem;
import com.erp.worklog.identity.IdentityClient.DeletedUserPage;
import com.erp.worklog.identity.IdentityClient.UserEvent;
import com.erp.worklog.identity.IdentityClient.UserEventPage;
import com.erp.worklog.identity.IdentityClient.UserItem;
import com.erp.worklog.identity.IdentityClient.UserPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

// common이 스케줄링을 켜므로 주기 작업이 테스트 중에 돌지 않게 미룬다. 작업은 테스트에서 직접 부른다.
@SpringBootTest(properties = { "worklog.feed.initial-delay=1h", "worklog.deleted-user.repurge-interval=1h",
		"worklog.deleted-user.cleanup-cron=-" })
@Import(PostgresTestConfig.class)
class UserSyncServiceTest {

	static final UUID ALICE = UUID.fromString("0192f3a0-0000-7000-8000-00000000000a");
	static final UUID BOB = UUID.fromString("0192f3a0-0000-7000-8000-00000000000b");
	static final UUID CAROL = UUID.fromString("0192f3a0-0000-7000-8000-00000000000c");

	@Autowired
	UserSyncService sync;
	@Autowired
	UserSyncJobs jobs;
	@Autowired
	UserSnapshotRepository snapshots;
	@Autowired
	DeletedUserRepository deletedUsers;
	@Autowired
	FeedCursorRepository cursor;
	@Autowired
	JdbcClient jdbc;
	@MockitoBean
	IdentityClient identity;

	@BeforeEach
	void reset() {
		jdbc.sql("DELETE FROM user_snapshot").update();
		jdbc.sql("DELETE FROM deleted_user").update();
		jdbc.sql("UPDATE feed_cursor SET last_seq = NULL").update();
	}

	@Test
	void firstPollDoesFullResyncAndSetsCursorToAsOfSeq() {
		when(identity.users(any(), anyInt())).thenReturn(new UserPage(
				List.of(new UserItem(ALICE, profile("앨리스")), new UserItem(BOB, profile("밥"))), null, 42));
		when(identity.deletedUsers(any(), anyInt())).thenReturn(new DeletedUserPage(
				List.of(new DeletedUserItem(CAROL, Instant.now())), null));

		sync.poll();

		assertThat(snapshots.find(ALICE)).hasValueSatisfying(s -> assertThat(s.profile().name()).isEqualTo("앨리스"));
		assertThat(snapshots.find(BOB)).isPresent();
		assertThat(deletedUsers.contains(CAROL)).isTrue();
		assertThat(cursor.lastSeq()).contains(42L);
	}

	@Test
	void eventsUpdateSnapshotAndDeleteRemovesDataAndRejectsUser() {
		cursor.save(10);
		// 탈퇴자의 과거 이벤트 행은 identity가 지우므로 seq에 빈 번호가 있다 (누락이 아니다)
		when(identity.userEvents(eq(10L), anyInt())).thenReturn(new UserEventPage(List.of(
				event(11, "CREATED", ALICE, profile("앨리스")),
				event(17, "PROFILE_UPDATED", ALICE, profile("앨리스2")),
				event(18, "CREATED", BOB, profile("밥")),
				event(25, "DELETED", BOB, null)), false));

		sync.poll();

		assertThat(snapshots.find(ALICE)).hasValueSatisfying(s -> assertThat(s.profile().name()).isEqualTo("앨리스2"));
		assertThat(snapshots.find(BOB)).isEmpty();
		assertThat(deletedUsers.contains(BOB)).isTrue();
		assertThat(cursor.lastSeq()).contains(25L);
	}

	@Test
	void olderEventDoesNotOverwriteNewerSnapshot() {
		snapshots.upsert(ALICE, profile("최신"), 20);

		snapshots.upsert(ALICE, profile("예전"), 15);

		assertThat(snapshots.find(ALICE)).hasValueSatisfying(s -> assertThat(s.profile().name()).isEqualTo("최신"));
	}

	@Test
	void profileEventForDeletedUserIsIgnored() {
		deletedUsers.add(ALICE);
		cursor.save(0);
		when(identity.userEvents(eq(0L), anyInt())).thenReturn(new UserEventPage(
				List.of(event(1, "PROFILE_UPDATED", ALICE, profile("앨리스"))), false));

		sync.poll();

		assertThat(snapshots.find(ALICE)).isEmpty();
	}

	@Test
	void expiredCursorFallsBackToFullResync() {
		cursor.save(5);
		when(identity.userEvents(anyLong(), anyInt())).thenThrow(new IdentityClient.FeedCursorExpiredException());
		when(identity.users(any(), anyInt())).thenReturn(new UserPage(List.of(new UserItem(ALICE, profile("앨리스"))), null, 99));
		when(identity.deletedUsers(any(), anyInt())).thenReturn(new DeletedUserPage(List.of(), null));

		sync.poll();

		assertThat(snapshots.find(ALICE)).isPresent();
		assertThat(cursor.lastSeq()).contains(99L);
	}

	@Test
	void repurgeRemovesDataWrittenAfterDeletionOnceTokensExpired() {
		deletedUsers.add(ALICE);
		// 탈퇴 반영 직전 처리 중이던 요청이 남긴 데이터
		snapshots.insertIfAbsent(ALICE, profile("남은 데이터"));
		jdbc.sql("UPDATE deleted_user SET deleted_at = now() - interval '16 minutes'").update();

		jobs.repurge();

		assertThat(snapshots.find(ALICE)).isEmpty();
		assertThat(jdbc.sql("SELECT repurged_at IS NOT NULL FROM deleted_user WHERE user_id = ?").param(ALICE)
				.query(Boolean.class).single()).isTrue();
	}

	@Test
	void cleanupKeepsRowsNotYetRepurged() {
		deletedUsers.add(ALICE);
		deletedUsers.add(BOB);
		jdbc.sql("UPDATE deleted_user SET deleted_at = now() - interval '8 days'").update();
		jdbc.sql("UPDATE deleted_user SET repurged_at = now() WHERE user_id = ?").param(ALICE).update();

		jobs.cleanupDeletedUsers();

		assertThat(deletedUsers.contains(ALICE)).isFalse();
		assertThat(deletedUsers.contains(BOB)).isTrue();
	}

	static Profile profile(String name) {
		return new Profile(name, null, null, "Asia/Seoul", "MONDAY", 31);
	}

	static UserEvent event(long seq, String type, UUID userId, Profile profile) {
		return new UserEvent(seq, type, userId, Instant.now(), profile);
	}
}

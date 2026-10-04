package com.erp.worklog.user;

import com.erp.worklog.identity.IdentityClient;
import com.erp.worklog.identity.IdentityClient.UserEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

/**
 * identity 사용자 변경 피드를 받아 사본 갱신·탈퇴 파기를 한다 (요구사항 5.4, D-45).
 * 이벤트 하나와 커서 저장을 같은 트랜잭션에 넣어, 중간에 실패해도 다음 실행이 그 이벤트부터 다시 한다.
 */
@Service
public class UserSyncService {

	private static final Logger log = LoggerFactory.getLogger(UserSyncService.class);
	static final int PAGE_SIZE = 100;

	private final IdentityClient identity;
	private final UserSnapshotRepository snapshots;
	private final DeletedUserRepository deletedUsers;
	private final FeedCursorRepository cursor;
	private final UserDataPurger purger;
	private final TransactionTemplate tx;

	UserSyncService(IdentityClient identity, UserSnapshotRepository snapshots, DeletedUserRepository deletedUsers,
			FeedCursorRepository cursor, UserDataPurger purger, TransactionTemplate tx) {
		this.identity = identity;
		this.snapshots = snapshots;
		this.deletedUsers = deletedUsers;
		this.cursor = cursor;
		this.purger = purger;
		this.tx = tx;
	}

	/** 쌓인 피드를 끝까지 가져온다. 커서가 없거나 보관 기간 밖이면 전체 재동기화한다. */
	public void poll() {
		Long after = cursor.lastSeq().orElse(null);
		if (after == null) {
			fullResync();
			return;
		}
		try {
			IdentityClient.UserEventPage page;
			do {
				page = identity.userEvents(after, PAGE_SIZE);
				for (UserEvent event : page.items()) {
					apply(event);
					after = event.seq();
				}
			} while (page.hasMore() && !page.items().isEmpty());
		} catch (IdentityClient.FeedCursorExpiredException e) {
			log.warn("피드 커서 {}가 보관 기간 밖이라 전체 재동기화한다", after);
			fullResync();
		}
	}

	void apply(UserEvent event) {
		tx.executeWithoutResult(status -> {
			switch (event.type()) {
				case "CREATED", "PROFILE_UPDATED" -> {
					if (!deletedUsers.contains(event.userId())) {
						snapshots.upsert(event.userId(), event.profile(), event.seq());
					}
				}
				case "DELETED" -> delete(event.userId());
				default -> log.warn("알 수 없는 피드 이벤트 {} (seq {})는 건너뛴다", event.type(), event.seq());
			}
			cursor.save(event.seq());
		});
	}

	/**
	 * 전체 목록으로 사본을 다시 채우고 탈퇴 기록을 다시 적용한 뒤 커서를 asOfSeq로 둔다.
	 * asOfSeq 이후 변경은 피드로 다시 오므로 페이지 사이에 바뀐 사용자도 결국 최신이 된다.
	 */
	public void fullResync() {
		Long asOfSeq = null;
		String next = null;
		do {
			IdentityClient.UserPage page = identity.users(next, PAGE_SIZE);
			if (asOfSeq == null) {
				asOfSeq = page.asOfSeq();
			}
			long seq = asOfSeq;
			tx.executeWithoutResult(status -> page.items().forEach(u -> {
				if (!deletedUsers.contains(u.userId())) {
					snapshots.upsert(u.userId(), u.profile(), seq);
				}
			}));
			next = page.nextCursor();
		} while (next != null);

		next = null;
		do {
			IdentityClient.DeletedUserPage page = identity.deletedUsers(next, PAGE_SIZE);
			tx.executeWithoutResult(status -> page.items().forEach(d -> delete(d.userId())));
			next = page.nextCursor();
		} while (next != null);

		cursor.save(asOfSeq);
		log.info("사용자 사본 전체 재동기화 완료, 커서 {}", asOfSeq);
	}

	private void delete(UUID userId) {
		deletedUsers.add(userId);
		purger.purge(userId);
	}
}

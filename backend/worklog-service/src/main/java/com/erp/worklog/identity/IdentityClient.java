package com.erp.worklog.identity;

import com.erp.worklog.user.Profile;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * identity 호출 (contracts/identity.yaml). 내부 API는 client credentials 서비스 토큰으로 부른다 (D-29).
 */
@Component
@EnableConfigurationProperties(IdentityProperties.class)
public class IdentityClient {

	static final String SCOPES = "user-events:read users:read";

	public record UserEvent(long seq, String type, UUID userId, Instant occurredAt, Profile profile) {
	}

	public record UserEventPage(List<UserEvent> items, boolean hasMore) {
	}

	public record UserItem(UUID userId, Profile profile) {
	}

	public record UserPage(List<UserItem> items, String nextCursor, long asOfSeq) {
	}

	public record DeletedUserItem(UUID userId, Instant deletedAt) {
	}

	public record DeletedUserPage(List<DeletedUserItem> items, String nextCursor) {
	}

	record TokenResponse(String access_token, long expires_in) {
	}

	/** after가 피드 보관 기간 밖이다 (410 FEED_CURSOR_EXPIRED). 전체 재동기화가 필요하다. */
	public static class FeedCursorExpiredException extends RuntimeException {
	}

	/** identity가 이 사용자를 탈퇴로 응답했다 (401 USER_DELETED). */
	public static class UserDeletedException extends RuntimeException {
	}

	/** identity를 부르지 못했거나 예상하지 못한 응답을 받았다. */
	public static class IdentityUnavailableException extends RuntimeException {
		public IdentityUnavailableException(String message) {
			super(message);
		}

		public IdentityUnavailableException(Throwable cause) {
			super(cause);
		}
	}

	private final RestClient rest;
	private final IdentityProperties props;
	private final Clock clock;
	private String serviceToken;
	private Instant serviceTokenRefreshAt = Instant.EPOCH;

	IdentityClient(RestClient.Builder builder, IdentityProperties props, Clock clock) {
		this.rest = builder.baseUrl(props.baseUri()).build();
		this.props = props;
		this.clock = clock;
	}

	public UserEventPage userEvents(long after, int limit) {
		return internal(() -> rest.get().uri("/internal/user-events?after={after}&limit={limit}", after, limit)
				.headers(h -> h.setBearerAuth(serviceToken()))
				.retrieve()
				.onStatus(s -> s.value() == HttpStatus.GONE.value(), (req, res) -> {
					throw new FeedCursorExpiredException();
				})
				.body(UserEventPage.class));
	}

	public UserPage users(String cursor, int limit) {
		return internal(() -> rest.get()
				.uri(b -> b.path("/internal/users").queryParam("limit", limit)
						.queryParamIfPresent("cursor", Optional.ofNullable(cursor)).build())
				.headers(h -> h.setBearerAuth(serviceToken()))
				.retrieve()
				.body(UserPage.class));
	}

	public DeletedUserPage deletedUsers(String cursor, int limit) {
		return internal(() -> rest.get()
				.uri(b -> b.path("/internal/deleted-users").queryParam("limit", limit)
						.queryParamIfPresent("cursor", Optional.ofNullable(cursor)).build())
				.headers(h -> h.setBearerAuth(serviceToken()))
				.retrieve()
				.body(DeletedUserPage.class));
	}

	/** 사본이 없을 때 사용자 토큰을 그대로 실어 공통 프로필을 조회한다 (P0-11 즉시 조회). */
	public Profile me(String userToken) {
		try {
			return rest.get().uri("/api/users/me")
					.headers(h -> h.setBearerAuth(userToken))
					.exchange((req, res) -> {
						if (res.getStatusCode().is2xxSuccessful()) {
							return res.bodyTo(Profile.class);
						}
						if (res.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
							ProblemDetail problem = res.bodyTo(ProblemDetail.class);
							if (problem != null && problem.getProperties() != null
									&& "USER_DELETED".equals(problem.getProperties().get("code"))) {
								throw new UserDeletedException();
							}
						}
						throw new IdentityUnavailableException("identity /api/users/me " + res.getStatusCode().value());
					});
		} catch (RestClientException e) {
			throw new IdentityUnavailableException(e);
		}
	}

	private synchronized String serviceToken() {
		if (serviceToken == null || !clock.instant().isBefore(serviceTokenRefreshAt)) {
			var form = new LinkedMultiValueMap<String, String>();
			form.add("grant_type", "client_credentials");
			form.add("scope", SCOPES);
			TokenResponse token = rest.post().uri("/internal/oauth/token")
					.headers(h -> h.setBasicAuth(props.clientId(), props.clientSecret()))
					.contentType(MediaType.APPLICATION_FORM_URLENCODED)
					.body(form)
					.retrieve()
					.body(TokenResponse.class);
			serviceToken = token.access_token();
			// 만료 30초 전에 새로 받는다
			serviceTokenRefreshAt = clock.instant().plusSeconds(Math.max(0, token.expires_in() - 30));
		}
		return serviceToken;
	}

	private <T> T internal(Supplier<T> request) {
		try {
			return request.get();
		} catch (RestClientResponseException e) {
			if (e.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
				// identity 키 교체 등으로 캐시한 서비스 토큰이 거부되면 다음 호출에서 새로 받는다
				invalidateServiceToken();
			}
			throw new IdentityUnavailableException(e);
		} catch (RestClientException e) {
			throw new IdentityUnavailableException(e);
		}
	}

	private synchronized void invalidateServiceToken() {
		serviceToken = null;
	}
}

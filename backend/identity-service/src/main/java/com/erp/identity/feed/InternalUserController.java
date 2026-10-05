package com.erp.identity.feed;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import com.erp.common.error.ApiException;
import com.erp.identity.user.Profile;

/**
 * 서비스 간 사용자 API (5.4, D-28). 서비스 토큰(aud=erp-internal)과 scope로만 호출한다(SecurityConfig).
 * limit 등 파라미터 검증은 Spring MVC 기본 메서드 검증이 400으로 응답한다.
 */
@Tag(name = "internal", description = "서비스 간 API (client credentials 서비스 토큰, D-28·D-29)")
@RestController
@RequestMapping("/internal")
public class InternalUserController {

	public static final String FEED_CURSOR_EXPIRED = "FEED_CURSOR_EXPIRED";

	private final JdbcTemplate jdbc;

	private final JsonMapper json;

	public InternalUserController(JdbcTemplate jdbc, JsonMapper json) {
		this.jdbc = jdbc;
		this.json = json;
	}

	@Schema(requiredProperties = { "seq", "type", "userId", "occurredAt" })
	public record UserEvent(long seq, UserEventType type, UUID userId, Instant occurredAt,
			@Schema(types = { "object", "null" }, implementation = Profile.class,
					description = "CREATED·PROFILE_UPDATED에만 있음. DELETED는 null") Profile profile) {
	}

	@Schema(requiredProperties = { "items", "hasMore" })
	public record UserEventPage(List<UserEvent> items, boolean hasMore) {
	}

	@Schema(requiredProperties = { "userId", "profile" })
	public record UserItem(UUID userId, Profile profile) {
	}

	@Schema(requiredProperties = { "items", "asOfSeq" })
	public record UserPage(List<UserItem> items,
			@Schema(types = { "string", "null" }) String nextCursor, long asOfSeq) {
	}

	@Schema(requiredProperties = { "userId", "deletedAt" })
	public record DeletedUser(UUID userId, Instant deletedAt) {
	}

	@Schema(requiredProperties = { "items" })
	public record DeletedUserPage(List<DeletedUser> items,
			@Schema(types = { "string", "null" }) String nextCursor) {
	}

	@Operation(operationId = "listUserEvents", summary = "사용자 변경 피드",
			description = "seq 오름차순. seq는 단조 증가하지만 연속이 아닐 수 있다. 30일 보관.",
			security = @SecurityRequirement(name = "serviceToken", scopes = "user-events:read"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "INVALID_CURSOR(cursor 형식 오류) 또는 BAD_REQUEST(after·limit 누락·범위 밖)",
			content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "서비스 토큰 없음·만료·aud 불일치 (UNAUTHENTICATED)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "403", description = "필요한 scope가 없음 (INSUFFICIENT_SCOPE)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "410", description = "FEED_CURSOR_EXPIRED: after가 보관 기간 밖. 전체 재동기화한다",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = "#/components/schemas/Problem")))
	@GetMapping("/user-events")
	@Transactional(readOnly = true)
	public UserEventPage userEvents(@RequestParam @Min(0) long after,
			@RequestParam(defaultValue = "100") @Min(1) @Max(500) int limit) {
		Long prunedThrough = jdbc.queryForObject("SELECT pruned_through FROM feed_retention WHERE id = 1", Long.class);
		if (after < prunedThrough) {
			throw new ApiException(HttpStatus.GONE, FEED_CURSOR_EXPIRED, "피드 보관 기간이 지났습니다. 전체 목록으로 다시 동기화하세요.");
		}
		List<UserEvent> events = jdbc.query(
				"SELECT seq, type, user_id, payload, created_at FROM user_events WHERE seq > ? ORDER BY seq LIMIT ?",
				(rs, i) -> new UserEvent(rs.getLong("seq"), UserEventType.valueOf(rs.getString("type")),
						rs.getObject("user_id", UUID.class), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
						profile(rs.getString("payload"))),
				after, limit + 1);
		boolean hasMore = events.size() > limit;
		return new UserEventPage(hasMore ? events.subList(0, limit) : events, hasMore);
	}

	@Operation(operationId = "listUsers", summary = "전체 사용자 목록 (재동기화용)",
			description = "탈퇴 사용자 제외. 모든 페이지를 받은 뒤 커서를 asOfSeq로 두고 피드를 이어서 읽는다.",
			security = @SecurityRequirement(name = "serviceToken", scopes = "users:read"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "INVALID_CURSOR(cursor 형식 오류) 또는 BAD_REQUEST(after·limit 누락·범위 밖)",
			content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "서비스 토큰 없음·만료·aud 불일치 (UNAUTHENTICATED)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "403", description = "필요한 scope가 없음 (INSUFFICIENT_SCOPE)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@GetMapping("/users")
	@Transactional(readOnly = true)
	public UserPage users(@RequestParam(required = false) String cursor,
			@RequestParam(defaultValue = "100") @Min(1) @Max(500) int limit) {
		// 커서 = "asOfSeq.마지막 userId". 첫 페이지에서 정한 asOfSeq를 마지막 페이지까지 그대로 넘긴다.
		// asOfSeq를 사용자 목록보다 먼저 읽는다. 그 뒤에 바뀐 사용자는 asOfSeq 이후 피드로 다시 온다.
		long asOfSeq;
		UUID lastId;
		if (cursor == null || cursor.isBlank()) {
			asOfSeq = jdbc.queryForObject("""
					SELECT GREATEST(COALESCE((SELECT max(seq) FROM user_events), 0), pruned_through)
					FROM feed_retention WHERE id = 1
					""", Long.class);
			lastId = null;
		}
		else {
			String[] parts = parseCursor(cursor);
			asOfSeq = Long.parseLong(parts[0]);
			lastId = UUID.fromString(parts[1]);
		}
		String sql = """
				SELECT id, name, organization, position, timezone, week_start, work_days, version FROM users
				%s ORDER BY id LIMIT ?
				""".formatted(lastId == null ? "" : "WHERE id > ?");
		Object[] args = lastId == null ? new Object[] { limit + 1 } : new Object[] { lastId, limit + 1 };
		List<UserItem> users = jdbc.query(sql,
				(rs, i) -> new UserItem(rs.getObject("id", UUID.class),
						new Profile(rs.getString("name"), rs.getString("organization"), rs.getString("position"),
								rs.getString("timezone"), DayOfWeek.valueOf(rs.getString("week_start")),
								rs.getInt("work_days"), rs.getLong("version"))),
				args);
		boolean hasMore = users.size() > limit;
		List<UserItem> page = hasMore ? users.subList(0, limit) : users;
		String next = hasMore ? asOfSeq + "." + page.get(page.size() - 1).userId() : null;
		return new UserPage(page, next, asOfSeq);
	}

	@Operation(operationId = "listDeletedUsers", summary = "탈퇴 기록 목록",
			description = "재동기화와 백업 복원 후 탈퇴 재적용(D-34)에 쓴다.",
			security = @SecurityRequirement(name = "serviceToken", scopes = "users:read"))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "INVALID_CURSOR(cursor 형식 오류) 또는 BAD_REQUEST(after·limit 누락·범위 밖)",
			content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "401", description = "서비스 토큰 없음·만료·aud 불일치 (UNAUTHENTICATED)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@ApiResponse(responseCode = "403", description = "필요한 scope가 없음 (INSUFFICIENT_SCOPE)", content = @Content(mediaType = "application/problem+json",
			schema = @Schema(ref = "#/components/schemas/Problem")))
	@GetMapping("/deleted-users")
	@Transactional(readOnly = true)
	public DeletedUserPage deletedUsers(@RequestParam(required = false) String cursor,
			@RequestParam(defaultValue = "100") @Min(1) @Max(500) int limit) {
		UUID lastId = cursor == null || cursor.isBlank() ? null : parseUuidCursor(cursor);
		String sql = "SELECT user_id, deleted_at FROM deleted_users %s ORDER BY user_id LIMIT ?"
			.formatted(lastId == null ? "" : "WHERE user_id > ?");
		Object[] args = lastId == null ? new Object[] { limit + 1 } : new Object[] { lastId, limit + 1 };
		List<DeletedUser> rows = jdbc.query(sql, (rs, i) -> new DeletedUser(rs.getObject("user_id", UUID.class),
				rs.getObject("deleted_at", OffsetDateTime.class).toInstant()), args);
		boolean hasMore = rows.size() > limit;
		List<DeletedUser> page = hasMore ? rows.subList(0, limit) : rows;
		return new DeletedUserPage(page, hasMore ? page.get(page.size() - 1).userId().toString() : null);
	}

	private Profile profile(String payload) {
		if (payload == null) {
			return null;
		}
		ObjectNode node = (ObjectNode) json.readTree(payload);
		if (!node.has("version")) {
			node.put("version", 0L); // P1-01 이전에 기록된 이벤트 (contracts/identity.yaml: 없으면 0)
		}
		return json.treeToValue(node, Profile.class);
	}

	private static String[] parseCursor(String cursor) {
		String[] parts = cursor.split("\\.", 2);
		try {
			if (parts.length == 2) {
				Long.parseLong(parts[0]);
				UUID.fromString(parts[1]);
				return parts;
			}
		}
		catch (IllegalArgumentException ex) {
			// 아래에서 400
		}
		throw invalidCursor();
	}

	private static UUID parseUuidCursor(String cursor) {
		try {
			return UUID.fromString(cursor);
		}
		catch (IllegalArgumentException ex) {
			throw invalidCursor();
		}
	}

	private static ApiException invalidCursor() {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "cursor가 올바르지 않습니다.");
	}

}

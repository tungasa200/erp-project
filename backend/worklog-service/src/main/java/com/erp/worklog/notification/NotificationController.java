package com.erp.worklog.notification;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.error.Errors;
import com.erp.worklog.notification.NotificationRepository.Notification;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 알림 센터 (P4-01, NOTI-01·LOG-16 — SCR-COM-05). */
@RestController
@RequestMapping("/api/worklog/notifications")
@Tag(name = "notifications")
class NotificationController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;

	private final NotificationRepository notifications;
	private final Clock clock;

	NotificationController(NotificationRepository notifications, Clock clock) {
		this.notifications = notifications;
		this.clock = clock;
	}

	@GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "listNotifications", summary = "알림 센터 목록 (P4-01, NOTI-01·LOG-16 — SCR-COM-05)",
			description = """
					최신순(createdAt 내림차순 → id). 30일이 지난 알림은 하루 1회 정리 작업이 지운다.
					unreadCount는 전체(페이지와 무관) 읽지 않은 수로, 사이드바 배지에 쓴다(배지는 limit=1로 불러도 된다).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "알림 목록")
	@ApiResponse(responseCode = "400", description = "cursor 형식이 틀림(code=INVALID_CURSOR) 또는 값 형식 오류(code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	NotificationList list(@Parameter(hidden = true) CurrentUser user,
			@Parameter(description = "이전 응답의 nextCursor. 처음이면 생략.") @RequestParam(required = false) String cursor,
			@Parameter(schema = @Schema(type = "integer", format = "int32", minimum = "1", maximum = "100", defaultValue = "30"))
			@RequestParam(defaultValue = "30") int limit) {
		if (limit < 1 || limit > 100) {
			throw Errors.invalid("limit", "OUT_OF_RANGE", "limit은 1~100이에요.");
		}
		var page = notifications.list(user.id(), cursor, limit);
		return new NotificationList(page.items().stream().map(NotificationView::of).toList(), page.unreadCount(), page.nextCursor());
	}

	@PostMapping("/{notificationId}/read")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "markNotificationRead", summary = "알림 하나 읽음 (항목 클릭, 웹 푸시 클릭으로 열 때)",
			description = "이미 읽었으면 그대로 204(멱등).", security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "읽음")
	@ApiResponse(responseCode = "404", description = "없거나 내 알림이 아님 (code=NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	void read(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID notificationId) {
		if (!notifications.markRead(user.id(), notificationId, clock.instant())) {
			throw Errors.notFound();
		}
	}

	@PostMapping("/read-all")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "markAllNotificationsRead", summary = "모두 읽음 (SCR-COM-05 ②)",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "읽지 않은 알림을 모두 읽음으로")
	void readAll(@Parameter(hidden = true) CurrentUser user) {
		notifications.markAllRead(user.id(), clock.instant());
	}

	record NotificationList(
			@Schema(requiredMode = RequiredMode.REQUIRED) List<NotificationView> items,
			@Schema(requiredMode = RequiredMode.REQUIRED) int unreadCount,
			@Schema(types = { "string", "null" }, description = "다음 페이지가 없으면 null") String nextCursor) {
	}

	@Schema(name = "Notification")
	record NotificationView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, implementation = NotificationType.class) String type,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "알림이 가리키는 날(하루 마감 대상일, 제안을 만든 날)") LocalDate date,
			@Schema(types = { "integer", "null" }, description = "DAILY_CLOSE일 때 보낼 때의 확인 대기 기록 수(스냅샷). 다른 종류는 null") Integer pendingCount,
			@Schema(types = { "string", "null" }, allowableValues = { "WEEKLY", "MONTHLY" }, description = "LOG_SUGGESTION일 때만") String logType,
			@Schema(types = { "string", "null" }, format = "date", description = "LOG_SUGGESTION일 때만") LocalDate periodStart,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED, types = { "string", "null" }, format = "date-time") Instant readAt) {

		static NotificationView of(Notification n) {
			return new NotificationView(n.id(), n.type(), n.date(), n.pendingCount(), n.logType(), n.periodStart(), n.createdAt(),
					n.readAt());
		}
	}

	@Schema(name = "NotificationType", description = """
			DAILY_CLOSE 하루 마감 시간(이동: SCR-LOG-03, date), LOG_SUGGESTION 주간·월간 일지 만들 차례(이동: 그 일지, logType·periodStart).""")
	enum NotificationType {
		DAILY_CLOSE, LOG_SUGGESTION
	}
}

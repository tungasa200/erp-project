package com.erp.worklog.notification;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.error.Errors;
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
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Clock;
import java.util.List;
import java.util.Locale;

/** 웹 푸시 구독 (P4-01, SCR-SET-05 ③). */
@RestController
@RequestMapping("/api/worklog/push")
@Tag(name = "notifications")
class PushController {

	/** SSRF 방지: 알려진 푸시 서비스만. 앞이 "."이면 그 아래 서브도메인. */
	static final List<String> ALLOWED_HOSTS = List.of("fcm.googleapis.com", "updates.push.services.mozilla.com",
			".notify.windows.com", "web.push.apple.com", ".push.apple.com");

	private final PushSubscriptionRepository subscriptions;
	private final VapidKeys keys;
	private final Clock clock;

	PushController(PushSubscriptionRepository subscriptions, VapidKeys keys, Clock clock) {
		this.subscriptions = subscriptions;
		this.keys = keys;
		this.clock = clock;
	}

	@GetMapping(path = "/public-key", produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "getPushPublicKey", summary = "웹 푸시 VAPID 공개 키 (P4-01, SCR-SET-05 ③)",
			description = """
					PushManager.subscribe의 applicationServerKey에 넣는 값(base64url, 비압축 P-256 공개 키 65바이트).
					공개 키라 비밀이 아니지만 서버 환경변수 하나(VAPID_PUBLIC_KEY)로 관리하려고 API로 준다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "공개 키")
	PublicKey publicKey() {
		return new PublicKey(keys.publicKey());
	}

	@PutMapping(path = "/subscriptions", consumes = MediaType.APPLICATION_JSON_VALUE)
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "savePushSubscription", summary = "이 브라우저의 푸시 구독 등록 (권한 허용 직후, 그리고 앱을 열 때마다 다시 보냄)",
			description = """
					PushSubscription.toJSON()의 endpoint·keys를 그대로 보낸다. endpoint가 같으면 덮어쓴다(다른 사용자 것이었으면 이 사용자로 옮긴다 — 같은 브라우저에서 계정을 바꾼 경우).
					사용자당 최대 10개, 넘으면 가장 오래 쓰지 않은 구독을 지운다.
					보안(SSRF 방지): endpoint는 https이고 호스트가 알려진 푸시 서비스여야 한다 —
					fcm.googleapis.com, updates.push.services.mozilla.com, *.notify.windows.com, web.push.apple.com, *.push.apple.com. 아니면 400(errors[].field=endpoint, code=NOT_ALLOWED).
					발송 때 푸시 서비스가 404·410을 주면 그 구독을 지운다.
					푸시 메시지 본문(서비스 워커 push 이벤트의 data.json()): {"type":"DAILY_CLOSE","notificationId":uuid,"title":string,"body":string|null,"url":"/logs/daily/{date}?close=1"}.
					서비스 워커는 title·body로 알림을 띄우고(tag=type), 누르면 notificationId를 읽음 처리하고 url을 연다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "저장됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED). errors[].code: REQUIRED, TOO_LONG, NOT_ALLOWED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	void save(@Parameter(hidden = true) CurrentUser user, @Valid @RequestBody SubscriptionBody body) {
		if (!allowed(body.endpoint())) {
			throw Errors.invalid("endpoint", "NOT_ALLOWED", "알 수 없는 푸시 서비스예요.");
		}
		subscriptions.save(user.id(), body.endpoint(), body.keys().p256dh(), body.keys().auth(), clock.instant());
	}

	@DeleteMapping("/subscriptions")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deletePushSubscription", summary = "이 브라우저의 푸시 구독 해제 (알림 끄기·로그아웃 때)",
			description = "없는 endpoint여도 204(멱등). 다른 사용자의 구독은 지우지 않는다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "지움")
	void delete(@Parameter(hidden = true) CurrentUser user, @RequestParam String endpoint) {
		subscriptions.delete(user.id(), endpoint);
	}

	static boolean allowed(String endpoint) {
		URI uri;
		try {
			uri = URI.create(endpoint);
		} catch (IllegalArgumentException e) {
			return false;
		}
		if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
				|| (uri.getPort() != -1 && uri.getPort() != 443)) {
			return false;
		}
		String host = uri.getHost().toLowerCase(Locale.ROOT);
		return ALLOWED_HOSTS.stream().anyMatch(a -> a.startsWith(".") ? host.endsWith(a) : host.equals(a));
	}

	record PublicKey(@Schema(requiredMode = RequiredMode.REQUIRED) String publicKey) {
	}

	@Schema(name = "PushSubscription")
	record SubscriptionBody(
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 1000)
			@NotBlank(message = "REQUIRED") @Size(max = 1000, message = "TOO_LONG") String endpoint,
			@Schema(requiredMode = RequiredMode.REQUIRED) @NotNull(message = "REQUIRED") @Valid Keys keys) {
	}

	@Schema(name = "PushSubscriptionKeys")
	record Keys(
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 200)
			@NotBlank(message = "REQUIRED") @Size(max = 200, message = "TOO_LONG") String p256dh,
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 100)
			@NotBlank(message = "REQUIRED") @Size(max = 100, message = "TOO_LONG") String auth) {
	}
}

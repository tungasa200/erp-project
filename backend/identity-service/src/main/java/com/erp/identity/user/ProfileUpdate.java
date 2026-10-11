package com.erp.identity.user;

import java.time.DayOfWeek;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import tools.jackson.databind.JsonNode;

import org.springframework.http.HttpStatus;

import com.erp.common.error.ApiException;
import com.erp.common.error.FieldErrorDetail;
import com.erp.common.error.Problems;

/**
 * PATCH /api/users/me 본문을 읽은 결과 (contracts/identity.yaml ProfileUpdateRequest).
 * 칸 없음과 null을 구분해야 해서 JSON을 직접 읽는다. 칸이 null이면 "보내지 않음"이다.
 * 이름·소속·직책은 {@link Text}로 감싸며, 안의 값이 null이면 지운다.
 */
public record ProfileUpdate(long version, Text name, Text organization, Text position, String timezone,
		DayOfWeek weekStart, Integer workDays, Boolean keyboardShortcutsEnabled, String themeAccent,
		String themeGround) {

	static final int MAX_TEXT = 100;

	/** #RRGGBB. input type=color가 소문자를 주므로 대소문자를 모두 받고 대문자로 저장한다. */
	private static final Pattern HEX_COLOR = Pattern.compile("^#[0-9A-Fa-f]{6}$");

	public record Text(String value) {
	}

	public static ProfileUpdate parse(JsonNode body) {
		if (body == null || !body.isObject()) {
			throw badRequest();
		}
		List<FieldErrorDetail> errors = new ArrayList<>();
		Long version = null;
		JsonNode v = body.get("version");
		if (v == null || v.isNull()) {
			errors.add(error("version", "REQUIRED"));
		}
		else if (!v.isIntegralNumber()) {
			throw badRequest();
		}
		else {
			version = v.longValue();
		}
		Text name = text(body, "name", errors);
		Text organization = text(body, "organization", errors);
		Text position = text(body, "position", errors);

		String timezone = null;
		JsonNode tz = required(body, "timezone", errors);
		if (tz != null) {
			if (!tz.isString()) {
				throw badRequest();
			}
			// IANA 이름만 받는다. ZoneId.of는 "+09:00" 같은 오프셋도 받으므로 목록으로 확인한다.
			if (ZoneId.getAvailableZoneIds().contains(tz.stringValue())) {
				timezone = tz.stringValue();
			}
			else {
				errors.add(error("timezone", "TIMEZONE_INVALID"));
			}
		}

		DayOfWeek weekStart = null;
		JsonNode ws = required(body, "weekStart", errors);
		if (ws != null) {
			try {
				weekStart = DayOfWeek.valueOf(ws.isString() ? ws.stringValue() : "");
			}
			catch (IllegalArgumentException ex) {
				throw badRequest();
			}
		}

		Integer workDays = null;
		JsonNode wd = required(body, "workDays", errors);
		if (wd != null) {
			if (!wd.isIntegralNumber()) {
				throw badRequest();
			}
			if (wd.canConvertToInt() && wd.intValue() >= 1 && wd.intValue() <= 127) {
				workDays = wd.intValue();
			}
			else {
				errors.add(error("workDays", "WORK_DAYS_INVALID"));
			}
		}

		Boolean shortcuts = null;
		JsonNode ks = required(body, "keyboardShortcutsEnabled", errors);
		if (ks != null) {
			if (!ks.isBoolean()) {
				throw badRequest();
			}
			shortcuts = ks.booleanValue();
		}

		String themeAccent = color(body, "themeAccent", "THEME_ACCENT_INVALID", errors);
		String themeGround = color(body, "themeGround", "THEME_GROUND_INVALID", errors);
		if (themeGround != null && !User.THEME_GROUNDS.contains(themeGround)) {
			errors.add(error("themeGround", "THEME_GROUND_INVALID"));
		}

		if (!errors.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, Problems.VALIDATION_FAILED, "입력값을 확인해 주세요.", errors,
					Map.of());
		}
		return new ProfileUpdate(version, name, organization, position, timezone, weekStart, workDays, shortcuts,
				themeAccent, themeGround);
	}

	/** 지울 수 없는 칸. 없으면 null(그대로), null을 보내면 REQUIRED. */
	private static JsonNode required(JsonNode body, String field, List<FieldErrorDetail> errors) {
		JsonNode node = body.get(field);
		if (node != null && node.isNull()) {
			errors.add(error(field, "REQUIRED"));
			return null;
		}
		return node;
	}

	/** #RRGGBB를 대문자로 바꿔 돌려준다. 형식이 틀리면 invalidCode 오류를 남기고 null. */
	private static String color(JsonNode body, String field, String invalidCode, List<FieldErrorDetail> errors) {
		JsonNode node = required(body, field, errors);
		if (node == null) {
			return null;
		}
		if (!node.isString()) {
			throw badRequest();
		}
		if (!HEX_COLOR.matcher(node.stringValue()).matches()) {
			errors.add(error(field, invalidCode));
			return null;
		}
		return node.stringValue().toUpperCase(Locale.ROOT);
	}

	/** 앞뒤 공백을 지운다. 빈 문자열과 null은 지움. */
	private static Text text(JsonNode body, String field, List<FieldErrorDetail> errors) {
		JsonNode node = body.get(field);
		if (node == null) {
			return null;
		}
		if (node.isNull()) {
			return new Text(null);
		}
		if (!node.isString()) {
			throw badRequest();
		}
		String value = node.stringValue().strip();
		if (value.codePointCount(0, value.length()) > MAX_TEXT) {
			errors.add(error(field, "TOO_LONG"));
			return null;
		}
		return new Text(value.isEmpty() ? null : value);
	}

	private static FieldErrorDetail error(String field, String code) {
		return new FieldErrorDetail(field, code, null);
	}

	private static ApiException badRequest() {
		return new ApiException(HttpStatus.BAD_REQUEST, Problems.BAD_REQUEST, "요청 형식이 올바르지 않습니다.");
	}

}

package com.erp.identity.user;

import java.time.DayOfWeek;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 모듈에 전달하는 공통 프로필 스냅샷 (contracts/identity.yaml Profile). email·테마는 넣지 않는다.
 * 사용자 변경 피드의 payload로 저장한다.
 */
@Schema(requiredProperties = { "timezone", "weekStart", "workDays" })
public record Profile(@Schema(types = { "string", "null" }) String name,
		@Schema(types = { "string", "null" }) String organization,
		@Schema(types = { "string", "null" }) String position, String timezone, DayOfWeek weekStart, int workDays) {
}

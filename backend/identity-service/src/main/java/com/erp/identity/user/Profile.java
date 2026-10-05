package com.erp.identity.user;

import java.time.DayOfWeek;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 모듈에 전달하는 공통 프로필 스냅샷 (contracts/identity.yaml Profile). email·테마·화면 설정은 넣지 않는다.
 * 사용자 변경 피드의 payload로 저장한다. version은 사용자 행의 낙관적 잠금 버전으로, 소비자가 더 새 값인지 비교하는 데 쓴다.
 */
@Schema(requiredProperties = { "timezone", "weekStart", "workDays", "version" })
public record Profile(@Schema(types = { "string", "null" }) String name,
		@Schema(types = { "string", "null" }) String organization,
		@Schema(types = { "string", "null" }) String position, String timezone, DayOfWeek weekStart, int workDays,
		long version) {
}

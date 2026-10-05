package com.erp.identity.user;

import java.time.DayOfWeek;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * PATCH /api/users/me 본문의 명세용 형태 (contracts/identity.yaml). 실제로는 {@link ProfileUpdate#parse}가
 * JSON을 직접 읽는다(칸 없음과 null 구분).
 */
@Schema(description = "보낸 칸만 수정한다. 칸 없음 = 그대로, null = 지움(이름·소속·직책만). 모르는 칸은 무시한다.",
		requiredProperties = { "version" })
public record ProfileUpdateRequest(@Schema(description = "마지막으로 받은 Me.version") long version,
		@Schema(types = { "string", "null" }, maxLength = 100) String name,
		@Schema(types = { "string", "null" }, maxLength = 100) String organization,
		@Schema(types = { "string", "null" }, maxLength = 100, description = "표시용 직책 (권한용 역할과 별개)") String position,
		@Schema(description = "IANA 시간대 이름. 바꿔도 기존 기록 날짜는 그대로다 (D-40).", example = "Asia/Seoul") String timezone,
		DayOfWeek weekStart,
		@Schema(minimum = "1", maximum = "127", description = "비트마스크 월=1 … 일=64. 최소 하루는 골라야 한다.") Integer workDays,
		@Schema(description = "키보드 단축키 사용 (UX-09). 피드에는 남기지 않는다.") Boolean keyboardShortcutsEnabled) {
}

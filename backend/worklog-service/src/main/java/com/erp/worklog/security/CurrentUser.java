package com.erp.worklog.security;

import java.util.UUID;

/**
 * 검증된 사용자 토큰의 sub로 식별한 현재 사용자. 컨트롤러 메서드 인자로 받는다.
 * 사용자 ID 헤더는 신뢰하지 않는다 (D-19).
 */
public record CurrentUser(UUID id) {
}

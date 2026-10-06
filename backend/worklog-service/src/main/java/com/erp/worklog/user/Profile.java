package com.erp.worklog.user;

/**
 * identity 공통 프로필 스냅샷 (contracts/identity.yaml Profile). 피드·전체 목록·/api/users/me가 같은 칸을 준다.
 * version은 identity User의 낙관적 잠금 값으로, 사본이 더 새것인지 가릴 때 쓴다. P0 피드 이벤트처럼 없으면 0.
 */
public record Profile(String name, String organization, String position, String timezone, String weekStart,
		int workDays, long version) {
}

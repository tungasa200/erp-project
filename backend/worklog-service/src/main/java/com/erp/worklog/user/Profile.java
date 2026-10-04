package com.erp.worklog.user;

/**
 * identity 공통 프로필 스냅샷 (contracts/identity.yaml Profile). 피드·전체 목록·/api/users/me가 같은 칸을 준다.
 */
public record Profile(String name, String organization, String position, String timezone, String weekStart,
		int workDays) {
}

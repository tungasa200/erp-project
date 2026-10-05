package com.erp.worklog.setting;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

interface UserSettingRepository extends JpaRepository<UserSetting, UUID> {
}

package com.erp.worklog.notification;

import java.util.UUID;

/**
 * 하루 마감 알림 시각에 영향이 있는 값(마감 시각·알림 켜기·프로필 시간대·업무 요일)이 바뀌었다 (P4-01, 5.6).
 * 발행한 트랜잭션 안에서 바로(동기) 다음 알림 시각을 다시 계산한다.
 */
public record NotifyScheduleChanged(UUID ownerId) {
}

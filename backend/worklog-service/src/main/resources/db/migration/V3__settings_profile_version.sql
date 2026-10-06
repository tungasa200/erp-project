-- P1-01. 사본은 피드 seq가 아니라 identity 프로필 version으로 새것을 가린다.
-- 저장 직후 즉시 갱신(/api/worklog/me/profile/refresh)은 seq를 모르기 때문이다. P0 피드 이벤트에는 version이 없어 0으로 본다.
ALTER TABLE user_snapshot ADD COLUMN profile_version BIGINT NOT NULL DEFAULT 0;

-- worklog 전용 설정 (요구사항 6장 UserSetting). 행이 없으면 기본값으로 응답하고 첫 수정 때 만든다.
-- 하루 마감 알림 시각(next_notify_at)은 알림을 만드는 P4에서 추가한다.
CREATE TABLE user_setting (
    owner_id              UUID        NOT NULL PRIMARY KEY,
    time_tracking_enabled BOOLEAN     NOT NULL,
    work_hours_start      TIME        NOT NULL,
    work_hours_end        TIME        NOT NULL,
    daily_close_time      TIME        NOT NULL,
    version               BIGINT      NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,
    CONSTRAINT user_setting_work_hours_order CHECK (work_hours_end > work_hours_start)
);

-- P4-01 하루 마감 알림·알림 센터·웹 푸시 (2026-10-10 확정, 사용자 카드 20261011-0400·0401). 계약 contracts/worklog.yaml notifications.
-- 탈퇴 파기(D-45)는 owner_id로 notification·push_subscription을 지운다.

-- 알림 켜기는 기본 꺼짐(카드 0401, 기존 사용자도 꺼짐). next_notify_at은 켜져 있을 때만 값이 있다(다음 근무일의 마감 시각, UTC).
ALTER TABLE user_setting ADD COLUMN daily_close_notify_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_setting ADD COLUMN next_notify_at TIMESTAMPTZ;
CREATE INDEX user_setting_next_notify_at ON user_setting (next_notify_at) WHERE next_notify_at IS NOT NULL;

-- 알림 센터 항목. 같은 날 같은 알림은 한 번만(재시도·중복 실행에도). 30일 지나면 정리 작업이 지운다.
CREATE TABLE notification (
    id             UUID        NOT NULL PRIMARY KEY,
    owner_id       UUID        NOT NULL,
    type           VARCHAR(14) NOT NULL CHECK (type IN ('DAILY_CLOSE', 'LOG_SUGGESTION')),
    date           DATE        NOT NULL,
    pending_count  INTEGER,
    log_type       VARCHAR(7)  CHECK (log_type IN ('WEEKLY', 'MONTHLY')),
    period_start   DATE,
    created_at     TIMESTAMPTZ NOT NULL,
    read_at        TIMESTAMPTZ,
    CONSTRAINT notification_suggestion CHECK ((type = 'LOG_SUGGESTION') = (log_type IS NOT NULL AND period_start IS NOT NULL))
);
CREATE UNIQUE INDEX notification_once ON notification (owner_id, type, date, coalesce(log_type, ''));
CREATE INDEX notification_list ON notification (owner_id, created_at DESC, id DESC);
CREATE INDEX notification_unread ON notification (owner_id) WHERE read_at IS NULL;

-- 브라우저 하나의 웹 푸시 구독. endpoint가 브라우저 구독의 식별자라 키로 쓴다(계정을 바꾸면 주인을 옮긴다).
CREATE TABLE push_subscription (
    endpoint     VARCHAR(1000) NOT NULL PRIMARY KEY,
    owner_id     UUID          NOT NULL,
    p256dh       VARCHAR(200)  NOT NULL,
    auth         VARCHAR(100)  NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL,
    last_used_at TIMESTAMPTZ   NOT NULL
);
CREATE INDEX push_subscription_owner ON push_subscription (owner_id, last_used_at);

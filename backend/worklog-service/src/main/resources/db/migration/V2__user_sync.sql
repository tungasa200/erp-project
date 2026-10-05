-- identity 공통 프로필의 읽기 전용 사본 (요구사항 5.4, 6장 UserSnapshot). 사용자 변경 피드와 즉시 조회로만 갱신한다.
CREATE TABLE user_snapshot (
    user_id      UUID         NOT NULL PRIMARY KEY,
    name         VARCHAR(100),
    organization VARCHAR(100),
    position     VARCHAR(100),
    timezone     VARCHAR(64)  NOT NULL,
    week_start   VARCHAR(9)   NOT NULL,
    work_days    SMALLINT     NOT NULL,
    last_seq     BIGINT       NOT NULL, -- 마지막으로 반영한 피드 seq. 즉시 조회로 만든 사본은 0
    synced_at    TIMESTAMPTZ  NOT NULL
);

-- 탈퇴 사용자 요청 거부 목록 (D-45). 개인정보 없음, 7일 뒤 정리
CREATE TABLE deleted_user (
    user_id     UUID        NOT NULL PRIMARY KEY,
    deleted_at  TIMESTAMPTZ NOT NULL, -- worklog가 탈퇴 이벤트를 반영한 시각
    repurged_at TIMESTAMPTZ           -- 남은 Access Token 만료 뒤 다시 파기한 시각
);

-- 사용자 변경 피드 소비 위치 (단일 행, D-45)
CREATE TABLE feed_cursor (
    id         SMALLINT    NOT NULL PRIMARY KEY CHECK (id = 1),
    last_seq   BIGINT,               -- NULL이면 아직 전체 동기화 전
    updated_at TIMESTAMPTZ NOT NULL
);
INSERT INTO feed_cursor (id, last_seq, updated_at) VALUES (1, NULL, now());

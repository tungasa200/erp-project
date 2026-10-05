-- identity schema 초기 구성 (P0-05). 데이터 모델은 요구사항정의서 6장.

-- ShedLock 잠금 테이블 (주기 작업 중복 실행 방지, D-31). common의 ShedLock 자동 설정이 쓴다.
CREATE TABLE shedlock (
    name       VARCHAR(64)  NOT NULL PRIMARY KEY,
    lock_until TIMESTAMPTZ  NOT NULL,
    locked_at  TIMESTAMPTZ  NOT NULL,
    locked_by  VARCHAR(255) NOT NULL
);

-- 계정과 공통 프로필 원본 (D-27). email은 앞뒤 공백 제거·소문자로 저장한다.
CREATE TABLE users (
    id                 UUID         NOT NULL PRIMARY KEY,
    email              VARCHAR(254) NOT NULL UNIQUE,
    email_verified_at  TIMESTAMPTZ,
    name               VARCHAR(100),
    organization       VARCHAR(100),
    position           VARCHAR(100),
    timezone           VARCHAR(64)  NOT NULL,
    week_start         VARCHAR(9)   NOT NULL,
    work_days          SMALLINT     NOT NULL CHECK (work_days BETWEEN 0 AND 127),
    theme_accent       CHAR(7)      NOT NULL,
    theme_ground       CHAR(7)      NOT NULL,
    failed_login_count INTEGER      NOT NULL DEFAULT 0,
    locked_until       TIMESTAMPTZ,
    version            BIGINT       NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL,
    updated_at         TIMESTAMPTZ  NOT NULL
);

-- 로그인 수단 (D-21). PASSWORD는 provider_subject에 사용자 ID를 넣는다.
CREATE TABLE user_credentials (
    id               UUID         NOT NULL PRIMARY KEY,
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider         VARCHAR(20)  NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    password_hash    VARCHAR(100),
    created_at       TIMESTAMPTZ  NOT NULL,
    UNIQUE (provider, provider_subject)
);
CREATE INDEX user_credentials_user_id_idx ON user_credentials (user_id);

-- Refresh Token (D-17). 원문은 저장하지 않고 SHA-256(hex)만 둔다. family = 로그인 세션 1개.
CREATE TABLE refresh_tokens (
    id         UUID        NOT NULL PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id  UUID        NOT NULL,
    token_hash CHAR(64)    NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- 사용자 변경 피드 (D-28, 5.4). 기록은 advisory lock으로 직렬화한다(UserFeed). 30일 보관.
-- 탈퇴 시 그 사용자의 CREATED·PROFILE_UPDATED 행을 지우므로 seq는 연속이 아닐 수 있다.
CREATE TABLE user_events (
    seq        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type       VARCHAR(20) NOT NULL,
    user_id    UUID        NOT NULL,
    payload    JSONB,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX user_events_user_id_idx ON user_events (user_id);
CREATE INDEX user_events_created_at_idx ON user_events (created_at);

-- 탈퇴 기록 (D-34). 식별 정보 없이 ID와 시각만. users를 참조하지 않는다(사용자 행은 지운다).
CREATE TABLE deleted_users (
    user_id    UUID        NOT NULL PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL
);

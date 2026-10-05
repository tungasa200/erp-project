-- 서비스 간 연동 (P0-11).

-- 서비스 토큰 발급 대상 (D-29). 비밀값은 BCrypt 해시만. 행은 기동 시 설정(환경 변수)에서 upsert한다(ServiceClientRegistrar).
CREATE TABLE service_clients (
    client_id   VARCHAR(50)  NOT NULL PRIMARY KEY,
    secret_hash VARCHAR(100) NOT NULL,
    scopes      VARCHAR(500) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL
);

-- 피드 보관 기간 정리로 지운 마지막 seq. after가 이보다 작으면 이미 지운 이벤트가 있어 410(FEED_CURSOR_EXPIRED).
-- 탈퇴로 지운 CREATED·PROFILE_UPDATED 행은 여기에 반영하지 않는다(소비자가 놓쳐도 DELETED로 처리된다).
CREATE TABLE feed_retention (
    id             SMALLINT NOT NULL PRIMARY KEY CHECK (id = 1),
    pruned_through BIGINT   NOT NULL
);
INSERT INTO feed_retention (id, pruned_through) VALUES (1, 0);

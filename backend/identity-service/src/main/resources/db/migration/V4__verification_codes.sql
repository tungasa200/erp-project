-- 이메일 인증(P1-12)·비밀번호 재설정(P1-13) 코드 (AUTH-08·03). 요구사항정의서 6장 EmailVerificationCode.
-- 계정·용도마다 가장 최근 행만 유효하다(새로 발급하면 이전 코드는 무효). 사용하면 expires_at을 사용 시각으로 당긴다.
-- 24시간 발송 한도를 세야 해서 발급 후 24시간 동안 남기고, 정리 작업(CleanupJobs)이 지운다.
CREATE TABLE verification_codes (
    id         UUID        NOT NULL PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    VARCHAR(20) NOT NULL,
    code_hash  CHAR(64)    NOT NULL, -- SHA-256(id + ':' + 코드), 행 id가 salt
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   SMALLINT    NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX verification_codes_user_purpose_idx ON verification_codes (user_id, purpose, created_at);
CREATE INDEX verification_codes_created_at_idx ON verification_codes (created_at);

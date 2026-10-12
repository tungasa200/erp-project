-- 가입 대기 (D-220): 인증 코드를 확인해야 users 행을 만든다. 확인 전 가입 신청은 여기에만 둔다.
-- 이메일당 한 행. 같은 이메일로 다시 신청하면 비밀번호와 코드를 덮어쓴다(이전 코드는 무효).
-- 코드 규칙은 verification_codes와 같다(D-64): 6자리, 10분, 5회. 코드는 SHA-256(code_salt + ':' + 코드)로만 저장한다.
-- sent_at은 최근 24시간 발송 시각(60초 간격·24시간 10통 한도용). 계정이 만들어지면 행을 지우고,
-- 확인하지 않은 행은 코드 만료 24시간 뒤 정리 작업(CleanupJobs)이 지운다.
CREATE TABLE pending_signups (
    email         VARCHAR(254)  NOT NULL PRIMARY KEY,
    password_hash VARCHAR(100)  NOT NULL,
    code_salt     UUID          NOT NULL,
    code_hash     CHAR(64)      NOT NULL,
    expires_at    TIMESTAMPTZ   NOT NULL,
    attempts      SMALLINT      NOT NULL DEFAULT 0,
    sent_at       TIMESTAMPTZ[] NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL
);
CREATE INDEX pending_signups_expires_at_idx ON pending_signups (expires_at);

-- P3 업무일지 (2026-10-08 확정, 사용자 카드 20261008-1130·1131). 계약 contracts/worklog.yaml logs.
-- P3-02 업무일지 (LOG-05·06, contracts/worklog.yaml logs). 요구사항정의서 6장 WorkLog.
-- id는 애플리케이션이 만드는 UUIDv7. 탈퇴 파기(D-45)는 owner_id로 work_log를 지우고 이력은 CASCADE로 함께 지운다.

-- 일지 하나 = (사용자, 종류, 기간 시작일). 일지가 없는 기간은 행이 없다(목록·미리보기는 원본으로 계산).
CREATE TABLE work_log (
    id           UUID        NOT NULL PRIMARY KEY,
    owner_id     UUID        NOT NULL,
    workspace_id UUID,
    type         VARCHAR(7)  NOT NULL CHECK (type IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,           -- 양끝 포함. 주간은 만들 때의 주 시작 요일 기준으로 고정
    status       VARCHAR(9)  NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
    -- 초안: 사용자가 고친 칸만 {"achievements": [...] | 없음(자동), "plans": [...], "issues": "..."}
    -- 확정: 그때 보인 LogContent 전체(작성자·수치·소요시간 포함) — 최신 revision.content와 같다
    content      JSONB       NOT NULL,
    confirmed_at TIMESTAMPTZ,
    version      BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    CONSTRAINT work_log_period UNIQUE (owner_id, type, period_start),
    CONSTRAINT work_log_period_order CHECK (period_end >= period_start),
    CONSTRAINT work_log_confirmed_at CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL))
);
-- 목록(기간 범위)은 UNIQUE 인덱스 (owner_id, type, period_start)로 받친다

-- 변경 이력 (LOG-06): 확정할 때마다 한 줄, 해제하면 그 줄에 시각을 적는다. 초안 편집은 남기지 않는다.
CREATE TABLE work_log_revision (
    log_id         UUID        NOT NULL REFERENCES work_log (id) ON DELETE CASCADE,
    revision_no    INTEGER     NOT NULL CHECK (revision_no >= 1),
    content        JSONB       NOT NULL,         -- 확정본 LogContent (열람·내보내기)
    confirmed_at   TIMESTAMPTZ NOT NULL,
    unconfirmed_at TIMESTAMPTZ,
    PRIMARY KEY (log_id, revision_no),
    CONSTRAINT work_log_revision_order CHECK (unconfirmed_at IS NULL OR unconfirmed_at >= confirmed_at)
);

-- AUTH-08 첫 내보내기 전 이메일 인증 (결정: 파일 내보내기 때 이 표에 없으면 사용자 토큰으로 identity GET /api/users/me의
-- emailVerified를 확인하고(프로필 즉시 조회와 같은 경로, identity 변경 없음), 인증됨만 기억한다).
-- 인증은 되돌아가지 않으므로 한 번 확인되면 다시 묻지 않는다. 개인정보(이메일)는 두지 않는다. 탈퇴 파기 때 지운다.
CREATE TABLE email_verified_user (
    user_id     UUID        NOT NULL PRIMARY KEY,
    verified_at TIMESTAMPTZ NOT NULL             -- worklog가 확인한 시각
);

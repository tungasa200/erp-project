-- P2-01 업무 기록 (REC-01, contracts/worklog.yaml records). 요구사항정의서 6장 WorkRecord.
-- id는 애플리케이션이 만드는 UUIDv7. 날짜 귀속(work_date)은 애플리케이션이 저장 시점에 계산해 넣고 이후 바꾸지 않는다 (D-40).
CREATE TABLE work_record (
    id               UUID          NOT NULL PRIMARY KEY,
    owner_id         UUID          NOT NULL,
    workspace_id     UUID,
    task_id          UUID          REFERENCES task (id),
    -- 일정을 지우면 NULL. 그 일정의 확인 대기(PENDING) 기록은 일정 삭제 서비스가 먼저 지운다
    schedule_id      UUID          REFERENCES schedule (id) ON DELETE SET NULL,
    occurrence_start TIMESTAMPTZ,  -- 회차 키 (D-71). 일정을 지워도 남아 출처 표시에 쓴다
    status           VARCHAR(9)    NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'DISMISSED')),
    work_date        DATE          NOT NULL,
    content          VARCHAR(500)  NOT NULL,
    result           VARCHAR(200),
    outcome          VARCHAR(16)   CHECK (outcome IN ('DONE', 'REVIEW_REQUESTED', 'IN_PROGRESS')),
    progress         SMALLINT      CHECK (progress BETWEEN 0 AND 100 AND progress % 10 = 0),
    start_at         TIMESTAMPTZ,
    end_at           TIMESTAMPTZ,
    duration_min     INTEGER       CHECK (duration_min BETWEEN 1 AND 1440),
    deleted_at       TIMESTAMPTZ,  -- 보관(소프트 삭제, NFR-05). 행이 남아 같은 회차의 확인 대기가 다시 생기지 않는다
    version          BIGINT        NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL,
    updated_at       TIMESTAMPTZ   NOT NULL,
    -- 확인 대기는 계획(회차)에서만 생긴다
    CONSTRAINT work_record_pending_from_plan CHECK (status <> 'PENDING' OR occurrence_start IS NOT NULL),
    CONSTRAINT work_record_schedule_has_occurrence CHECK (schedule_id IS NULL OR occurrence_start IS NOT NULL),
    CONSTRAINT work_record_progress_only_in_progress CHECK (progress IS NULL OR outcome = 'IN_PROGRESS'),
    CONSTRAINT work_record_end_after_start CHECK (end_at IS NULL OR (start_at IS NOT NULL AND end_at > start_at)),
    -- (일정, 회차 시작) 하나에 기록 하나: 보여줄 때 생성(INSERT ... ON CONFLICT DO NOTHING)이 동시에 불려도 하나만 (D-31, P2-03)
    CONSTRAINT work_record_occurrence UNIQUE (schedule_id, occurrence_start)
);
-- 기간 조회(일 보기·일지·업무 기록 이력)와 자주 하는 업무 집계(8주, CONFIRMED)를 받친다
CREATE INDEX work_record_owner_date ON work_record (owner_id, work_date) WHERE deleted_at IS NULL;
CREATE INDEX work_record_task ON work_record (task_id);

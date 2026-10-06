-- P1-02·P1-03 (TASK-01~05, contracts/worklog.yaml 0.2.0). 업무 표는 프로젝트 업무 수·태그 사용 수 집계에 필요해 함께 만든다.
-- 모든 표는 owner_id와 향후 팀 확장용 workspace_id(NULL)를 가진다 (요구사항 5.3). id는 애플리케이션이 만드는 UUIDv7.
-- 이름 중복은 앞뒤 공백을 뺀 값(애플리케이션)을 소문자로 비교한다.

CREATE TABLE project (
    id           UUID         NOT NULL PRIMARY KEY,
    owner_id     UUID         NOT NULL,
    workspace_id UUID,
    name         VARCHAR(50)  NOT NULL,
    color        VARCHAR(2)   NOT NULL CHECK (color IN ('P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8')),
    archived_at  TIMESTAMPTZ,
    version      BIGINT       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL
);
CREATE UNIQUE INDEX project_owner_name ON project (owner_id, lower(name));

CREATE TABLE tag (
    id           UUID         NOT NULL PRIMARY KEY,
    owner_id     UUID         NOT NULL,
    workspace_id UUID,
    name         VARCHAR(30)  NOT NULL,
    version      BIGINT       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL
);
CREATE UNIQUE INDEX tag_owner_name ON tag (owner_id, lower(name));

CREATE TABLE task (
    id                UUID         NOT NULL PRIMARY KEY,
    owner_id          UUID         NOT NULL,
    workspace_id      UUID,
    project_id        UUID         REFERENCES project (id),
    title             VARCHAR(200) NOT NULL,
    status            VARCHAR(11)  NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'ON_HOLD')),
    priority          VARCHAR(6)   NOT NULL CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
    due_date          DATE,
    progress          SMALLINT     NOT NULL CHECK (progress BETWEEN 0 AND 100 AND progress % 10 = 0),
    completed_at      TIMESTAMPTZ,
    memo              VARCHAR(5000),
    carried_over_from UUID         REFERENCES task (id) ON DELETE SET NULL, -- 이월 원본 (P3 LOG-13)
    deleted_at        TIMESTAMPTZ,                                          -- 보관(소프트 삭제)
    version           BIGINT       NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL,
    updated_at        TIMESTAMPTZ  NOT NULL,
    CONSTRAINT task_completed_at_only_when_done CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);
-- 목록 기본 정렬(마감일, 없으면 뒤 → id)과 생성 역순(id)을 받친다. UUIDv7이라 id 순서가 생성 순서다
CREATE INDEX task_owner_due ON task (owner_id, due_date, id) WHERE deleted_at IS NULL;
CREATE INDEX task_owner_id ON task (owner_id, id);
CREATE INDEX task_project ON task (project_id);

CREATE TABLE task_tag (
    task_id UUID NOT NULL REFERENCES task (id) ON DELETE CASCADE,
    tag_id  UUID NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX task_tag_tag ON task_tag (tag_id);

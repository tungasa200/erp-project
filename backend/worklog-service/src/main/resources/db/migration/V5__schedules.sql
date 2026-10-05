-- P1-05·06 일정과 반복 일정 (SCH-02·03, contracts/worklog.yaml schedules). 요구사항정의서 6장 ScheduleEvent.
-- 시간 일정은 start_at·end_at, 종일 일정은 start_date·end_date(포함)만 값을 가진다. timezone은 만들 때 사용자 시간대로 고정한다(D-40).
-- 반복은 RFC 5545 RRULE 문자열(FREQ·BYDAY·UNTIL·COUNT)이다. id는 애플리케이션이 만드는 UUIDv7.
CREATE TABLE schedule (
    id              UUID          NOT NULL PRIMARY KEY,
    owner_id        UUID          NOT NULL,
    workspace_id    UUID,
    task_id         UUID          REFERENCES task (id),
    title           VARCHAR(200)  NOT NULL,
    all_day         BOOLEAN       NOT NULL,
    start_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    start_date      DATE,
    end_date        DATE,
    timezone        VARCHAR(64)   NOT NULL,
    recurrence_rule VARCHAR(100),
    memo            VARCHAR(5000),
    -- 기간 조회용 전체 구간: 첫 회차 시작 ~ 마지막 회차 끝(회차별로 옮긴 시각 포함). 끝없는 반복이면 span_end는 NULL
    span_start      TIMESTAMPTZ   NOT NULL,
    span_end        TIMESTAMPTZ,
    version         BIGINT        NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL,
    updated_at      TIMESTAMPTZ   NOT NULL,
    CONSTRAINT schedule_timing CHECK (
        (all_day AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date
            AND start_at IS NULL AND end_at IS NULL)
        OR (NOT all_day AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at
            AND start_date IS NULL AND end_date IS NULL))
);
CREATE INDEX schedule_owner_span ON schedule (owner_id, span_start);
CREATE INDEX schedule_task ON schedule (task_id);

-- 반복 일정의 회차별 변경("이 일정만", SCR-CAL-08). occurrence_start는 원래 회차 시작(종일은 원래 날짜의 일정 시간대 0시).
-- cancelled면 그 회차를 뺀다. 그 밖의 칸은 NULL이면 일정 값을 따른다(memo는 memo_overridden으로 "비움"과 구분).
CREATE TABLE schedule_exception (
    schedule_id      UUID          NOT NULL REFERENCES schedule (id) ON DELETE CASCADE,
    occurrence_start TIMESTAMPTZ   NOT NULL,
    cancelled        BOOLEAN       NOT NULL,
    title            VARCHAR(200),
    start_at         TIMESTAMPTZ,
    end_at           TIMESTAMPTZ,
    start_date       DATE,
    end_date         DATE,
    memo             VARCHAR(5000),
    memo_overridden  BOOLEAN       NOT NULL,
    PRIMARY KEY (schedule_id, occurrence_start)
);

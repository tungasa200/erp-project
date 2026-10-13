-- 보관함 영구 삭제: 업무(DELETE /api/worklog/tasks/{taskId}/permanent, 카드 20261013-1000)와
-- 프로젝트(DELETE /api/worklog/projects/{projectId}/permanent, 카드 20261013-1010).
-- 업무를 지우면 기록·일정은 남기고 업무 연결만, 프로젝트를 지우면 업무는 남기고 프로젝트 연결만 비운다.
-- V4~V6에는 이 FK들에 ON DELETE 규칙이 없어 삭제가 막혔다.
-- 업무의 확인 대기(PENDING) 기록은 서비스가 삭제 전에 먼저 지운다. task_tag(CASCADE)·carried_over_from(SET NULL)은 V4 그대로.
-- 제약 이름은 V4~V6의 인라인 REFERENCES에 PostgreSQL이 붙인 기본 이름이다(같은 DDL이면 운영도 같다).
-- 이름이 다르면 DROP이 실패하고 이 마이그레이션 전체가 롤백된다(PostgreSQL DDL은 트랜잭션 안). 확인:
--   SELECT conrelid::regclass, conname FROM pg_constraint
--   WHERE conrelid IN ('task'::regclass, 'schedule'::regclass, 'work_record'::regclass) AND contype = 'f';

ALTER TABLE task DROP CONSTRAINT task_project_id_fkey;
ALTER TABLE task ADD CONSTRAINT task_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE SET NULL;

ALTER TABLE schedule DROP CONSTRAINT schedule_task_id_fkey;
ALTER TABLE schedule ADD CONSTRAINT schedule_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE SET NULL;

ALTER TABLE work_record DROP CONSTRAINT work_record_task_id_fkey;
ALTER TABLE work_record ADD CONSTRAINT work_record_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE SET NULL;

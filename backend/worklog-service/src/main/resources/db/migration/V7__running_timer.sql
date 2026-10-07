-- P2-06 타이머 (TIME-03 동시 1개, contracts/worklog.yaml timer).
-- 타이머는 따로 표를 두지 않는다. 실행 중 타이머 = 시작만 있고 끝·소요시간이 없는 보관하지 않은 기록.
-- 사용자당 하나만 허용한다: /timer/start가 앞 타이머를 정지하고 새로 넣는 사이에 다른 요청이 끼어들어도 DB가 두 번째를 거부한다.
-- 보관(deleted_at)한 실행 중 기록은 빠지므로, 복원할 때 다른 타이머가 돌고 있으면 서비스가 409 TIMER_RUNNING을 낸다.
-- 주의: P2-01 배포 뒤 startAt만 있는 기록이 사용자당 둘 이상 있으면 인덱스 생성이 실패한다. 적용 전 운영 DB에서 아래로 확인한다.
--   SELECT owner_id, count(*) FROM work_record
--   WHERE start_at IS NOT NULL AND end_at IS NULL AND duration_min IS NULL AND deleted_at IS NULL
--   GROUP BY owner_id HAVING count(*) > 1;
CREATE UNIQUE INDEX work_record_one_running ON work_record (owner_id)
    WHERE start_at IS NOT NULL AND end_at IS NULL AND duration_min IS NULL AND deleted_at IS NULL;

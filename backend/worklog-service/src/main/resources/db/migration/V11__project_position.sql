-- 프로젝트 순서 (contracts/worklog.yaml 0.8.0, 사용자 카드 20261028-0100). 목록은 position → id로 정렬한다.
-- 기존 데이터는 지금 보이는 순서(사용자별 id 순 = 만든 순서)로 1부터 채운다. 보관한 프로젝트와 겹칠 수 있어 유일 제약은 두지 않는다.

ALTER TABLE project ADD COLUMN position INTEGER;

UPDATE project p
SET position = r.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY id) AS rn FROM project) r
WHERE p.id = r.id;

ALTER TABLE project ALTER COLUMN position SET NOT NULL;
-- 인덱스는 더하지 않는다: 사용자별 프로젝트가 수십 개라 owner_id 조회(project_owner_name 인덱스 앞부분) 뒤 메모리 정렬로 충분하다.

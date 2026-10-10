# 운영 점검·백업 복원 시험 절차 (P4-07) — 초안

근거: NFR-05, D-34(백업 7일 이내·복원 시 탈퇴 재적용), D-35(외부 도구 없이 로그·헬스), D-175 ④(Railway 임시 서비스에 복원 → 탈퇴 재적용 시험 → 즉시 삭제).
콘솔 작업은 `WY-browser`, 판정·SQL은 `WY-backend1`. 임시 서비스를 만드는 단계(2)는 시작 직전 `WY-pm`이 비용 확인 카드를 올리고 답을 받은 뒤 한다.
🔒 비밀값(DB 비밀번호 등)은 콘솔에서만 쓰고 이 문서·메시지·로그에 남기지 않는다.

## 1. 점검 (비용 없음) — WY-browser 작업 목록

Railway 콘솔에서 보기만 한다(설정 변경·재시작·삭제 없음). 각 항목의 "보고할 것"만 `WY-pm`에 보내고, 판정은 `WY-backend1`이 한다.
화면에 비밀값·이메일 원문이 보이면 옮겨 적지 않고 "보임"이라고만 보고한다.

| # | 어디서 | 할 일 | 보고할 것 | 통과 기준(판정용) |
|---|---|---|---|---|
| 1 | Postgres 서비스 → Backups | 백업 일정·보관 설정과 목록 확인 | 일정(Daily 등), 보관 일수, 백업 개수, 가장 최근 백업 시각(KST), 그 백업 크기 | Daily, 보관 6일, 개수 6 이하, 최근 백업이 24시간 안 |
| 2 | 프로젝트 → 서비스 목록 | 서비스 상태 확인 | 서비스별 상태(Active/Crashed 등)와 마지막 배포 시각 | gateway·identity·worklog·Postgres 모두 Active |
| 3 | 브라우저 주소창 | 운영 도메인 `/api/worklog/health` 열기 | 응답 상태 코드 | 401(로그인 없이 막힘이 정상) |
| 4 | gateway·identity·worklog → Logs, 최근 24시간 | 로그 형식과 ERROR 확인 | 한 줄 JSON인지, `traceId` 칸이 있는지, level=ERROR 개수와 반복되는 메시지 첫 줄(있으면) | JSON 한 줄, traceId 있음, 같은 ERROR가 반복되지 않음 |
| 5 | identity → Logs | 검색어 `USER_DELETED` | 최근 30일 검색 결과 개수(ID 값은 적지 않음) | 검색이 된다(복원 때 재적용 목록 출처 3.1 ②) |
| 6 | worklog → Logs | 검색어 `feed`(피드 처리 로그) | 30초마다 오류가 반복되는지 | poll 오류 반복 없음 |
| 7 | 프로젝트 설정 | 로그 보관 기간·요금제 | 보관 기간, 요금제 이름 | 30일(Pro) |
| 8 | 계정 설정 → Notification Rules | 크래시 알림 규칙 | 규칙 목록(대상 서비스·채널 종류) | README "검증 결과" 표와 같음 |
| 9 | Postgres → Backups | 복원 메뉴 위치만 확인(누르지 않음) | "새 볼륨/서비스로 복원" 같은 선택지가 있는지, 예상 비용 안내 문구 | 2장 3단계를 운영 DB를 덮지 않고 할 수 있음 |

## 2. 복원 시험 (임시 서비스, 비용 카드 뒤)

1. 시험 전 운영에서 시험 계정 A·B를 만든다. 각자 업무·일정·기록을 1개 이상 넣는다.
2. 최근 백업 시각 T 뒤에 B를 탈퇴시킨다(P4-05 API). A는 그대로 둔다.
   - 이 순서로 "백업에는 B가 살아 있고, 운영에서는 탈퇴했다"는 상황을 만든다.
3. Postgres → Backups에서 T 백업을 **새 임시 볼륨/서비스로** 복원한다. 운영 DB에 덮어쓰지 않는다.
4. 임시 DB에서 확인: A·B 모두 `identity.users`에 있다(복원 직후 상태).
5. 탈퇴 재적용(아래 3장)을 임시 DB에 실행한다.
6. 임시 DB에서 확인: B의 `identity.users` 행 없음, `identity.deleted_users`에 B, `identity.user_events`에 B의 DELETED만, A는 그대로.
   worklog 파기는 임시 DB에 worklog가 붙어 있지 않아 일어나지 않는다. 확인 방법은 3.4.
7. 임시 서비스·볼륨을 바로 삭제하고 삭제를 화면으로 확인한다. 시험 계정 A를 운영에서 탈퇴시킨다.
8. 결과(시각, 백업 크기, 걸린 시간, 확인 쿼리 결과 행 수)를 README "검증 결과"에 남긴다. 사용자 식별 정보는 적지 않는다.

## 3. 탈퇴 재적용 — 두 방식 (어느 쪽을 쓸지는 비용 카드 때 사용자 결정)

문제: 볼륨 백업은 DB 전체를 T 시점으로 되돌린다. T 뒤에 탈퇴한 사용자는 복원된 DB의 `deleted_users`에도 없으므로, 복원된 DB만으로는 재적용할 목록을 얻을 수 없다.

### 3.1 재적용 목록 (두 방식 공통)

1. **운영 DB가 살아 있으면** 운영 DB에서 `SELECT user_id, deleted_at FROM identity.deleted_users WHERE deleted_at >= 'T'`. 데이터 일부 손상으로 복원할 때.
2. **운영 DB를 잃었으면** identity 로그. 탈퇴 때 `USER_DELETED userId=<id>`를 JSON 로그 한 줄로 남긴다(UserDeletionService, 식별 정보 아님, 로그 보관 30일 > 백업 6일). Railway 로그에서 T 뒤 항목을 모아 user_id와 로그 시각을 쓴다.

목록은 이 저장소·메시지에 붙이지 않고 콘솔 작업 안에서만 쓴다(ID지만 탈퇴자 목록이므로).

### 3.2 방식 A — SQL 직접 실행 (코드 변경 없음, 추천)

`UserDeletionService.delete`·`UserFeed.deleted`와 같은 일을 한 트랜잭션으로 한다. 이미 지워진 사용자는 건너뛰므로 여러 번 실행해도 결과가 같다.
Railway Postgres의 Data/Query 화면이나 psql로 복원된 DB에 실행한다. 피드 순번 잠금(`UserFeed.FEED_LOCK_KEY = 7001`)을 같이 잡아 identity가 동시에 쓰는 이벤트와 순서가 섞이지 않게 한다.

```sql
BEGIN;
SELECT pg_advisory_xact_lock(7001);
CREATE TEMP TABLE reapply (user_id uuid PRIMARY KEY, deleted_at timestamptz NOT NULL) ON COMMIT DROP;
-- 3.1 목록을 넣는다. 예: INSERT INTO reapply VALUES ('<user_id>', '<탈퇴 시각>'), (...);
INSERT INTO reapply VALUES /* 목록 */;

WITH gone AS (
  -- users를 지우면 FK(ON DELETE CASCADE)로 로그인 수단·refresh token·인증 코드가 함께 지워진다
  DELETE FROM identity.users u USING reapply r WHERE u.id = r.user_id RETURNING u.id
), recorded AS (
  INSERT INTO identity.deleted_users (user_id, deleted_at)
  SELECT user_id, deleted_at FROM reapply ON CONFLICT (user_id) DO NOTHING
), announced AS (
  -- worklog가 피드로 읽고 자기 데이터를 파기한다
  INSERT INTO identity.user_events (type, user_id, payload, created_at)
  SELECT 'DELETED', id, NULL, now() FROM gone
)
DELETE FROM identity.user_events e USING reapply r
WHERE e.user_id = r.user_id AND e.type IN ('CREATED', 'PROFILE_UPDATED');

-- 확인: 0, 목록 수, 목록 수(DELETED만), 0 이어야 한다
SELECT (SELECT count(*) FROM identity.users u JOIN reapply r ON u.id = r.user_id) AS users_left,
       (SELECT count(*) FROM identity.deleted_users d JOIN reapply r USING (user_id)) AS recorded,
       (SELECT count(*) FROM identity.user_events e JOIN reapply r USING (user_id) WHERE e.type = 'DELETED') AS deleted_events,
       (SELECT count(*) FROM identity.user_events e JOIN reapply r USING (user_id) WHERE e.type <> 'DELETED') AS other_events;
COMMIT; -- 확인 값이 다르면 ROLLBACK
```

- 장점: 코드·API·권한 추가 없음, 복원 직후 identity를 띄우기 전에도 실행할 수 있음.
- 단점: DB 관리자 계정으로 콘솔에서 SQL을 직접 쓴다(실수 위험 → 확인 쿼리와 ROLLBACK으로 막음). 스키마가 바뀌면 이 SQL도 함께 고쳐야 한다(identity 마이그레이션을 바꿀 때 이 문서를 확인).

### 3.3 방식 B — 운영자용 내부 API (코드 추가 필요)

identity에 `POST /internal/users/deletions/reapply`(본문: user_id·탈퇴 시각 목록)를 추가해 각 사용자에 `UserDeletionService.delete`를 그대로 부른다. gateway가 라우팅하지 않는 `/internal/**` 경로이고 서비스 토큰에 새 scope(`identity.admin` 가칭)를 둔다. 운영자는 Railway 내부망에서 실행하는 일회성 명령(예: identity 컨테이너 셸의 curl)으로 부른다.

- 장점: 앱 코드와 같은 삭제 경로라 스키마가 바뀌어도 따라감, 테스트로 검증 가능.
- 단점: API 계약·서비스 토큰 scope·비밀값(운영자 클라이언트) 추가 → 보안 범위가 넓어짐(사용자 결정 필요), 복원 뒤 identity가 떠 있어야 함, P4 일정에 구현·테스트 반나절 정도 추가. 탈퇴 시각은 실행 시각으로 남는다(원래 시각을 넘기려면 서비스 수정 필요).

### 3.4 worklog 쪽 (두 방식 공통)

worklog는 복원 뒤 피드 커서가 T 시점으로 돌아가 있으므로, 재적용으로 새로 쌓인 DELETED 이벤트(와 T 이전 이벤트)를 다시 읽어 스스로 파기한다(30초 주기, 15분 뒤 한 번 더). 별도 SQL은 없다.
2장 시험에서는 임시 DB에 worklog가 붙어 있지 않으므로 worklog 파기는 실제로 일어나지 않는다. 시험에서는 ① 재적용 뒤 `identity.user_events`에 B의 DELETED가 피드 커서(`worklog.feed_cursor` 행)보다 큰 순번으로 있는지 확인하고, ② worklog 파기 자체는 CI 테스트(worklog 피드 소비·탈퇴 처리)로 이미 검증된 것으로 갈음한다. 임시 worklog 서비스까지 띄우면 비용·작업이 늘어 하지 않는다.


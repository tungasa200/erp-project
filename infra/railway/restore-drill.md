# 운영 점검·백업 복원 시험 절차 (P4-07)

근거: NFR-05, D-34(백업 7일 이내·복원 시 탈퇴 재적용), D-35(외부 도구 없이 로그·헬스), D-175 ④, 사용자 결정 카드 20261011-0610(복원 시험은 임시 Postgres 서비스, 재적용은 SQL 직접 실행, 로그 검색은 사용자가 콘솔에서 직접).
1장 콘솔 점검은 `WY-browser`, 2장 콘솔 클릭과 터미널 실행은 사용자, 판정·SQL은 `WY-backend1`.
🔒 비밀값(DB 접속 URL·비밀번호 등)은 콘솔과 내 터미널에서만 쓰고 이 문서·메시지·로그에 남기지 않는다.

## 1. 점검 (비용 없음)

Railway 콘솔에서 보기만 한다(설정 변경·재시작·삭제 없음). 각 항목의 "보고할 것"만 `WY-pm`에 보내고, 판정은 `WY-backend1`이 한다.
화면에 비밀값·이메일 원문이 보이면 옮겨 적지 않고 "보임"이라고만 보고한다.

| # | 어디서 | 할 일 | 보고할 것 | 통과 기준(판정용) | 결과 (2026-10-11) |
|---|---|---|---|---|---|
| 1 | Postgres 서비스 → Backups | 백업 일정·보관 설정과 목록 확인 | 일정(Daily 등), 보관 일수, 백업 개수, 가장 최근 백업 시각(KST), 그 백업 크기 | Daily, 보관 6일, 개수 6 이하, 최근 백업이 24시간 안 | 통과 |
| 2 | 프로젝트 → 서비스 목록 | 서비스 상태 확인 | 서비스별 상태(Active/Crashed 등)와 마지막 배포 시각 | gateway·identity·worklog·Postgres 모두 Active | 통과 |
| 3 | 브라우저 주소창 | 운영 도메인 `/api/worklog/health` 열기 | 응답 상태 코드 | 401(로그인 없이 막힘이 정상) | 통과 |
| 4 | gateway·identity·worklog → Deploy Logs, 최근 24시간 (HTTP Logs 아님) | `@level:error`·`@level:warn` 검색, 아무 줄이나 열어 속성 확인 | ERROR·WARN 개수와 반복되는 문구, 속성 칸(logger_name 등), traceId 칸(요청 처리 중 남은 줄이 있을 때) | JSON으로 읽힘(속성 칸이 나옴), 같은 ERROR가 반복되지 않음. traceId는 요청 처리 중 남은 줄에만 있어 그런 줄이 없으면 해당 없음 | 통과 ¹ ³ |
| 5 | identity → Deploy Logs | 검색어 `USER_DELETED` | 최근 30일 검색 결과 개수(ID 값은 적지 않음) | 시험 탈퇴 1건 뒤 검색된다(복원 때 재적용 목록 출처 3.1 ②) | P4 배포 뒤 확인 ⁴ |
| 6 | worklog → Deploy Logs | 검색어 `피드`(피드 실패 WARN은 한글 문구) | 결과 개수와 30초마다 반복되는지 | 0건이거나 반복 없음 | 통과 (0건) |
| 7 | 프로젝트 설정 | 로그 보관 기간·요금제 | 보관 기간, 요금제 이름 | 30일(Pro) | 통과 |
| 8 | 계정 설정 → Notification Rules | 크래시 알림 규칙 | 규칙 목록(대상 서비스·채널 종류) | README "검증 결과" 표와 같음 | 통과 |
| 9 | Postgres → Backups | 복원 메뉴 위치만 확인(누르지 않음) | "새 볼륨/서비스로 복원" 같은 선택지가 있는지, 예상 비용 안내 문구 | 운영 DB를 덮지 않고 복원할 수 있는지 판단 | 확인함 ² |

¹ 자동화 브라우저에서는 로그 필터가 먹지 않아 사용자가 콘솔에서 직접 본다(카드 0610, CLI는 설치하지 않음). 이후 Deploy Logs URL에 `&filter=` 쿼리를 붙이는 방식으로 WY-browser가 확인했다(카드 0620·0710).
² 새 서비스로 복원하는 선택지는 없다. Restore는 확인 창 없이 staged change를 만들고, Deploy하면 백업으로 만든 새 볼륨이 **같은 운영 Postgres 서비스**에 붙고 원래 볼륨은 분리된다(Railway 문서: 백업은 같은 프로젝트·환경, 그 볼륨의 서비스에만 복원). 환경·서비스를 복제해도 볼륨 데이터는 따라오지 않는다. 그래서 2장은 운영 백업을 복원하지 않고, 임시 서비스에서 같은 Restore 동작을 시험한다. 비용 안내 문구는 화면에 없고, 단가로 계산하면 임시 서비스 3시간에 약 0.1달러다.
³ 2026-10-10 23:41 KST 기준. 세 서비스 모두 활성 배포(10-08 23:31)의 기동 줄(23~30줄) 뒤로 앱 로그가 없다. 운영 코드는 성공 요청·피드 폴링·정리 작업에 로그를 남기지 않고, 실패 WARN과 처리 못 한 예외 ERROR만 남기므로 정상이다. 수집이 멈추지 않았다는 근거: gateway HTTP Logs에 10-09~10-10 요청 120줄이 계속 쌓였다(23:09 health 401 포함). ERROR·WARN 0, 피드 WARN 0, 처리 못 한 예외 줄이 없어 traceId는 해당 없음. 속성 칸에 문자열 `level` 키가 보이지 않는 것은 Railway가 그 값을 자체 심각도로 가져가기 때문이다(`@level:info` 필터로 기동 줄 23줄이 걸러짐, `level_value`는 남아 있음).
⁴ 0건은 정상이다. `USER_DELETED` 로그(UserDeletionService)는 P4-05 코드라 운영에 아직 배포되지 않았다. P4 배포 뒤 시험 탈퇴 1건으로 검색되는지 본다. 이것이 앱 로그가 운영에서 수집되는지의 최종 확인도 겸한다.

## 2. 복원 시험 — 임시 Postgres `restore-drill-pg` (카드 0610)

운영 데이터와 운영 Postgres는 쓰지 않는다. 같은 환경에 임시 Postgres를 만들어 시험 계정만 넣고, **그 임시 서비스의** 수동 백업 → 탈퇴 → Restore·Deploy → 탈퇴 재적용(3.2) → 확인 → 삭제를 한다. 운영 백업 자체는 1장 1번(목록·크기·시각)으로 확인한다.

> ⚠ 콘솔에서 누르는 단계(🖱) 앞에는 매번 **화면 위쪽 서비스 이름이 `restore-drill-pg`인지** 확인한다. 운영 Postgres의 이름은 `Postgres`다. Restore는 확인 창 없이 staged change를 만든다.

준비: Docker가 켜진 이 PC의 PowerShell 터미널(psql을 Docker로 띄운다, 설치 없음). 걸리는 시간 1시간 안팎.
psql 대신 콘솔 Data의 쿼리 화면으로 할 때는 7·9·10단계에 3.2-콘솔의 한 문장을 쓴다.

1. 🖱 시작 전: 프로젝트 화면 위쪽에 staged changes(배포 대기 변경)가 **없는지** 본다. 있으면 멈추고 `WY-pm`에 알린다(7단계 Deploy 때 함께 배포되면 안 된다).
2. 🖱 프로젝트 → 운영 환경 → **+ Create** → **Database** → **PostgreSQL**. 만들어진 서비스 → **Settings** → 이름을 `restore-drill-pg`로 바꾼다.
3. 🖱 [이름 확인: `restore-drill-pg`] → **Variables** → `DATABASE_PUBLIC_URL` 값을 복사한다(비밀값, 아래 터미널에만 붙여 넣는다).
4. 터미널: psql을 연다. 접속 URL은 입력할 때 화면에 보이지 않는다.
   ```powershell
   $s = Read-Host "DATABASE_PUBLIC_URL 붙여넣기" -AsSecureString
   $u = [Net.NetworkCredential]::new('', $s).Password
   docker run --rm -it -v "C:\projects\erp-project\backend\identity-service\src\main\resources\db\migration:/m:ro" postgres:17-alpine psql $u
   ```
5. psql: identity 스키마를 운영과 같은 마이그레이션 파일로 만들고 시험 계정 A·B를 넣는다. 끝 줄 결과가 `2`여야 한다.
   ```sql
   CREATE SCHEMA identity;
   SET search_path TO identity;
   \i /m/V1__init.sql
   \i /m/V2__service_clients_feed_retention.sql
   \i /m/V3__keyboard_shortcuts.sql
   \i /m/V4__verification_codes.sql
   INSERT INTO users (id, email, timezone, week_start, work_days, theme_accent, theme_ground, version, created_at, updated_at) VALUES
     ('00000000-0000-7000-8000-00000000000a', 'drill-a@example.invalid', 'Asia/Seoul', 'MONDAY', 62, '#4B3FD6', '#F2F4FA', 0, now(), now()),
     ('00000000-0000-7000-8000-00000000000b', 'drill-b@example.invalid', 'Asia/Seoul', 'MONDAY', 62, '#4B3FD6', '#F2F4FA', 0, now(), now());
   INSERT INTO user_events (type, user_id, payload, created_at) VALUES
     ('CREATED', '00000000-0000-7000-8000-00000000000a', '{}', now()),
     ('CREATED', '00000000-0000-7000-8000-00000000000b', '{}', now());
   SELECT count(*) FROM users;
   ```
   마이그레이션 파일이 바뀌면(V5 이상) 그 파일도 순서대로 `\i` 한다.
6. 🖱 [이름 확인: `restore-drill-pg`] → **Backups** → **Create backup**(수동 백업). 목록에 새 백업이 생기면 그 시각을 T로 적는다.
7. psql: T 뒤에 B를 탈퇴시킨다. 임시 DB에는 identity 앱이 붙어 있지 않으므로, 앱이 탈퇴 때 하는 일과 같은 3.2 SQL을 B 한 명으로 실행한다. 3.2 블록에서 `INSERT INTO reapply VALUES /* 목록 */;` 줄만 아래로 바꿔 붙여 넣고, 확인 값이 `0 | 1 | 1 | 0`이면 `COMMIT;`.
   ```sql
   INSERT INTO reapply VALUES ('00000000-0000-7000-8000-00000000000b', now());
   ```
   이것으로 "백업에는 B가 살아 있고, 지금은 탈퇴했다"는 상황이 된다.
8. 🖱 [이름 확인: `restore-drill-pg`] → **Backups** → T 백업 줄의 **Restore**. 화면 위 staged changes를 열어 **바뀌는 서비스가 `restore-drill-pg` 하나뿐인지** 확인한 뒤 **Deploy**(Restore만 누르면 staged 상태로 남아 반영되지 않는다, 2026-10-11 시험). 다른 서비스가 보이면 Deploy하지 말고 Discard 후 `WY-pm`에 알린다. 재배포가 끝나면(서비스 Active) 4단계 psql은 끊겨 있으므로 4단계 명령으로 다시 연다.
9. psql: 복원 직후 상태 확인. `2 | 0`이어야 한다(B가 되살아났고 탈퇴 기록이 없다).
   ```sql
   SET search_path TO identity;
   SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM deleted_users) AS deleted;
   SELECT max(seq) AS seq_before FROM user_events;
   ```
10. psql: 탈퇴 재적용. 7단계와 똑같이 3.2 블록을 B 한 줄로 붙여 넣는다(실제 복원에서는 3.1 목록의 user_id·탈퇴 시각을 넣는다). 확인 값이 `0 | 1 | 1 | 0`이면 `COMMIT;`. 이어서 확인한다:
    ```sql
    SELECT (SELECT count(*) FROM users) AS users,                                  -- 1 (A만)
           (SELECT count(*) FROM users WHERE email = 'drill-a@example.invalid') AS a, -- 1
           (SELECT max(seq) FROM user_events WHERE type = 'DELETED') AS deleted_seq; -- 9단계 seq_before보다 커야 한다
    ```
    `deleted_seq > seq_before`이면 worklog가 복원 뒤 피드를 다시 읽을 때 이 DELETED를 받는다(3.4).
11. psql을 `\q`로 닫는다. 🖱 [이름 확인: `restore-drill-pg`] → **Settings** → **Delete service**(붙은 볼륨도 함께 지운다). 8단계 Restore로 분리된 원래 볼륨이 프로젝트 화면에 따로 남아 있으면 그것도 지운다. 프로젝트 화면에 `restore-drill-pg`와 그 볼륨이 없는지 확인한다.
12. 결과(시험 날짜, T, 백업 크기, Restore~Deploy 걸린 시간, 5·9·10단계 확인 값)를 README "검증 결과"에 남긴다. 접속 URL은 적지 않는다.

## 3. 탈퇴 재적용 — 방식 A SQL 직접 실행으로 확정 (카드 0610)

문제: 볼륨 백업은 DB 전체를 T 시점으로 되돌린다. T 뒤에 탈퇴한 사용자는 복원된 DB의 `deleted_users`에도 없으므로, 복원된 DB만으로는 재적용할 목록을 얻을 수 없다.

### 3.1 재적용 목록

1. **운영 DB가 살아 있으면** 운영 DB에서 `SELECT user_id, deleted_at FROM identity.deleted_users WHERE deleted_at >= 'T'`. 데이터 일부 손상으로 복원할 때.
2. **운영 DB를 잃었으면** identity 로그. 탈퇴 때 `USER_DELETED userId=<id>`를 JSON 로그 한 줄로 남긴다(UserDeletionService, 식별 정보 아님, 로그 보관 30일 > 백업 6일). Railway 로그에서 T 뒤 항목을 모아 user_id와 로그 시각을 쓴다.

목록은 이 저장소·메시지에 붙이지 않고 콘솔 작업 안에서만 쓴다(ID지만 탈퇴자 목록이므로).

### 3.2 SQL 직접 실행

`UserDeletionService.delete`·`UserFeed.deleted`와 같은 일을 한 트랜잭션으로 한다. 이미 지워진 사용자는 건너뛰므로 여러 번 실행해도 결과가 같다.
복원된 DB에 psql(2장 4단계 방식)로 실행한다. 피드 순번 잠금(`UserFeed.FEED_LOCK_KEY = 7001`)을 같이 잡아 identity가 동시에 쓰는 이벤트와 순서가 섞이지 않게 한다.

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
```

블록에는 `COMMIT`을 넣지 않았다(붙여 넣는 즉시 확정되지 않게). 확인 값을 본 뒤 맞으면 `COMMIT;`, 다르면 `ROLLBACK;`을 직접 친다.

- 코드·API·권한 추가 없음, 복원 직후 identity를 띄우기 전에도 실행할 수 있음.
- DB 관리자 계정으로 SQL을 직접 쓰므로 확인 쿼리와 ROLLBACK으로 실수를 막는다. 스키마가 바뀌면 이 SQL도 함께 고친다(identity 마이그레이션을 바꿀 때 이 문서를 확인).

### 3.2-콘솔 Railway 쿼리 화면용 한 문장 (2장 임시 DB 시험 전용)

Railway 콘솔 Data의 쿼리 화면은 `BEGIN`~`COMMIT` 묶음·임시 테이블을 오류 없이 반영하지 않고, 결과 표도 마지막 문장만 보여 준다(2026-10-11 시험에서 확인). 그래서 2장을 psql 대신 이 화면으로 할 때는 7·10단계에서 아래 **한 문장**을 그대로 붙여 넣어 한 번 실행한다. 한 문장은 그 자체로 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않는다.

```sql
WITH r(user_id, deleted_at) AS (
  VALUES ('00000000-0000-7000-8000-00000000000b'::uuid, now())
), gone AS (
  DELETE FROM identity.users u USING r WHERE u.id = r.user_id RETURNING u.id
), recorded AS (
  INSERT INTO identity.deleted_users (user_id, deleted_at)
  SELECT user_id, deleted_at FROM r ON CONFLICT (user_id) DO NOTHING RETURNING user_id
), announced AS (
  INSERT INTO identity.user_events (type, user_id, payload, created_at)
  SELECT 'DELETED', id, NULL, now() FROM gone RETURNING seq
), purged AS (
  DELETE FROM identity.user_events e USING r
  WHERE e.user_id = r.user_id AND e.type IN ('CREATED', 'PROFILE_UPDATED') RETURNING e.seq
)
-- 한 문장 안의 SELECT는 실행 전 상태를 보므로, 실행 전 개수에 이번에 바뀐 행 수를 더하고 뺀다
SELECT (SELECT count(*) FROM identity.users u JOIN r ON u.id = r.user_id) - (SELECT count(*) FROM gone) AS users_left,
       (SELECT count(*) FROM identity.deleted_users d JOIN r USING (user_id)) + (SELECT count(*) FROM recorded) AS recorded,
       (SELECT count(*) FROM identity.user_events e JOIN r USING (user_id) WHERE e.type = 'DELETED') + (SELECT count(*) FROM announced) AS deleted_events,
       (SELECT count(*) FROM identity.user_events e JOIN r USING (user_id) WHERE e.type <> 'DELETED') - (SELECT count(*) FROM purged) AS other_events;
```

- 기대 결과: `0 | 1 | 1 | 0`. 다시 실행해도(이미 지워진 B) `0 | 1 | 1 | 0`이고 아무것도 더 바뀌지 않는다. 7단계·10단계 모두 같은 문장이다.
- 확정이 곧바로 된다(psql판의 "확인 뒤 COMMIT/ROLLBACK" 단계가 없다). 그래서 이 판은 시험 계정 B만 든 임시 DB에서만 쓴다.
- 피드 순번 잠금(`pg_advisory_xact_lock(7001)`)은 뺐다: 임시 DB에는 identity 앱이 붙어 있지 않아 `user_events`에 동시에 쓰는 쪽이 없으므로 순서가 섞일 일이 없다(한 문장 안에서는 잠금이 데이터 변경보다 먼저 잡힌다는 보장도 없다).
- 실제 복원은 3.2 psql판(잠금·확인 뒤 COMMIT)을 그대로 쓴다.
- 쿼리 화면 주의(2026-10-11 시험): 입력칸이 실행 뒤 비워지지 않고 새 입력이 이어 붙는다 → 입력칸 클릭 → Ctrl+A → Delete 뒤 붙여 넣는다. SELECT라도 문장에 `DELETED` 글자가 있으면 destructive 확인 창이 뜬다(확인하고 진행).
- 9단계도 이 화면에서는 한 문장으로 본다. 기대 `2 | 0 | <seq_before>`:
  ```sql
  SELECT (SELECT count(*) FROM identity.users) AS users, (SELECT count(*) FROM identity.deleted_users) AS deleted, (SELECT max(seq) FROM identity.user_events) AS seq_before;
  ```
  10단계 끝 확인 쿼리는 테이블 이름 앞에 `identity.`를 붙여 그대로 쓴다.

### 3.3 검토 후 채택 안 함 — 운영자용 내부 API

identity에 재적용용 내부 API(`/internal/**`, 새 서비스 토큰 scope)를 두는 방식도 검토했다. API 계약·scope·운영자 비밀값이 늘어 보안 범위가 넓어지고 복원 뒤 identity가 떠 있어야 해서 채택하지 않았다(카드 0610).

### 3.4 worklog 쪽

worklog는 복원 뒤 피드 커서가 T 시점으로 돌아가 있으므로, 재적용으로 새로 쌓인 DELETED 이벤트(와 T 이전 이벤트)를 다시 읽어 스스로 파기한다(30초 주기, 15분 뒤 한 번 더). 별도 SQL은 없다.
2장 시험에서는 임시 DB에 worklog가 붙어 있지 않으므로 worklog 파기는 실제로 일어나지 않는다. 시험에서는 ① 재적용 뒤 B의 DELETED 순번이 복원 직후 가장 큰 순번보다 큰지 확인하고(2장 9·10단계, 복원된 worklog 피드 커서는 그 이하이므로 다시 읽는다), ② worklog 파기 자체는 CI 테스트(worklog 피드 소비·탈퇴 처리)로 이미 검증된 것으로 갈음한다. 임시 worklog 서비스까지 띄우면 비용·작업이 늘어 하지 않는다.


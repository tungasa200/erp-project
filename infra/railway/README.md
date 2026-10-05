# 운영 배포 설정 (P0-09)

Railway 프로젝트 WY-ERP(싱가포르)에 백엔드 3개와 PostgreSQL, Vercel에 프론트엔드를 둔다.
🔒 표시는 비밀값이다. 사용자가 콘솔에 직접 입력하고 저장소·메시지·로그에 남기지 않는다.

## Railway

배포 브랜치: P0 동안 `feature/P0-skeleton`, P0을 main에 병합한 뒤 `main`.

### PostgreSQL

1. 싱가포르 리전에 PostgreSQL 서비스를 추가한다. 서비스 이름은 `Postgres`(아래 참조 변수가 이 이름을 쓴다).
2. Data → Query에서 [db-setup.sql](db-setup.sql)을 실행한다. `<IDENTITY_DB_PASSWORD>`·`<WORKLOG_DB_PASSWORD>`는 🔒 새로 만든 값으로 바꿔 실행한다.
3. 백업: Volume backups Daily(24시간마다, 보관 6일), PITR 미사용. Railway 콘솔이 고르는 값이라 7일이 아니다(요구사항·작업계획서 개정 대기).

### 서비스 3개 공통

| 항목 | 값 |
|---|---|
| 서비스 이름 | `api-gateway`, `identity-service`, `worklog-service` (private 도메인이 이 이름을 쓴다) |
| Source | GitHub `tungasa200/erp-project`, 배포 브랜치 |
| Root Directory | `/backend` |
| Config File (Config as Code) | 비운다. Railway가 폐지 중이라 새 서비스에는 적용되지 않는다. 아래 네 항목을 콘솔에서 직접 설정한다 |
| Builder | Dockerfile |
| Dockerfile 경로 | `/backend/Dockerfile` (콘솔은 저장소 기준 절대경로로 받고, Root Directory를 정하면 이 값이 기본으로 표시된다) |
| Healthcheck | Path `/actuator/health/readiness`, Timeout 120초 (경로를 저장해야 Timeout 칸이 나타난다) |
| Restart Policy | On Failure, 최대 10회 |
| 리전·인스턴스 | 싱가포르, 1개 |
| 공개 도메인 | `api-gateway`에만 만든다 (대상 포트 8080). identity·worklog는 만들지 않는다 |

### 서비스별 변수

출처: 입력 = 콘솔에 직접 입력, 참조 = Railway 참조 변수.

**api-gateway**

| 변수 | 값 | 출처 |
|---|---|---|
| `SERVICE` | `api-gateway` | 입력 (Dockerfile 빌드 인자) |
| `SPRING_PROFILES_ACTIVE` | `prod` | 입력 |
| `PORT` | `8080` | 입력 |
| `IDENTITY_URI` | `http://identity-service.railway.internal:8081` | private 도메인 |
| `WORKLOG_URI` | `http://worklog-service.railway.internal:8082` | private 도메인 |
| `IDENTITY_JWKS_URI` | `http://identity-service.railway.internal:8081/.well-known/jwks.json` | private 도메인 |
| `ALLOWED_ORIGINS` | `https://project-7qtt1.vercel.app,https://wy-worklog.com` (운영 도메인만. www는 apex로 리디렉션되므로 넣지 않고, 프리뷰 도메인도 넣지 않는다. project-7qtt1은 전환 기간 동안 유지) | 입력 |
| `ORIGIN_SECRET` | 🔒 32바이트 이상 난수 (`openssl rand -hex 32`), Vercel과 같은 값 | 입력 |

**identity-service**

| 변수 | 값 | 출처 |
|---|---|---|
| `SERVICE` | `identity-service` | 입력 |
| `SPRING_PROFILES_ACTIVE` | `prod` (없으면 키·비밀값 기본값 차단이 꺼짐) | 입력 |
| `PORT` | `8081` | 입력 |
| `DB_URL` | `jdbc:postgresql://${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | 참조 |
| `DB_USERNAME` | `identity_app` | 입력 |
| `DB_PASSWORD` | 🔒 db-setup.sql에 넣은 identity 비밀번호 | 입력 |
| `JWT_PRIVATE_KEY` | 🔒 RSA 2048 PKCS#8 PEM 전문 (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.pem`). 한 줄로 붙일 때는 줄바꿈을 `\n`으로 | 입력 |
| `JWT_KEY_ID` | 예: `2026-10` (키를 바꿀 때 함께 바꾼다) | 입력 |
| `WORKLOG_CLIENT_SECRET` | 🔒 `openssl rand -base64 32`, worklog의 `IDENTITY_CLIENT_SECRET`과 같은 값 | 입력 |

**worklog-service**

| 변수 | 값 | 출처 |
|---|---|---|
| `SERVICE` | `worklog-service` | 입력 |
| `SPRING_PROFILES_ACTIVE` | `prod` (없거나 비밀값이 로컬 기본값이면 기동 실패) | 입력 |
| `PORT` | `8082` | 입력 |
| `DB_URL` | identity와 같음 | 참조 |
| `DB_USERNAME` | `worklog_app` | 입력 |
| `DB_PASSWORD` | 🔒 db-setup.sql에 넣은 worklog 비밀번호 | 입력 |
| `IDENTITY_URI` | `http://identity-service.railway.internal:8081` | private 도메인 |
| `IDENTITY_JWKS_URI` | gateway와 같음 | private 도메인 |
| `IDENTITY_CLIENT_ID` | `worklog` | 입력 |
| `IDENTITY_CLIENT_SECRET` | 🔒 identity의 `WORKLOG_CLIENT_SECRET`과 같은 값 | 입력 |

`PORT`를 고정하는 이유: 내부 호출 주소(`*.railway.internal:포트`)에 포트가 들어간다.

## Vercel

| 항목 | 값 |
|---|---|
| 팀 | tungasa200s-projects (Hobby) |
| 저장소 | `tungasa200/erp-project` |
| Root Directory | `frontend` (여기에 있는 [vercel.json](../../frontend/vercel.json)이 적용된다) |
| 프레임워크·빌드 | Vite, `npm run build`, 출력 `dist` |
| 환경 변수 | `ORIGIN_SECRET` 🔒 gateway와 같은 값 (Production·Preview) |
| 도메인 | `wy-worklog.com`(기본), `www.wy-worklog.com` → apex 308, `project-7qtt1.vercel.app`(전환 기간 유지). D-55 |
| DNS | 가비아(네임서버는 옮기지 않음): `A @ 216.198.79.1`, `CNAME www a7a87af42f090385.vercel-dns-017.com.` |
| SSL | Let's Encrypt, Vercel 자동 갱신 (2026-10-05 기준 만료 2027-01-03) |

vercel.json이 하는 일: `/api/*`를 Gateway 공개 도메인으로 프록시하면서 `x-origin-secret` 헤더를 붙이고(없거나 틀리면 Gateway가 404), 외부 rewrite 캐시를 끄고, 나머지 경로는 `index.html`(SPA)로 보낸다. `/assets/` 아래 없는 파일은 404다.

프리뷰 배포: `/api`는 운영 Gateway로 가지만 프리뷰 도메인은 `ALLOWED_ORIGINS`에 없어 로그인·가입 같은 쓰기 요청이 403이 된다(의도한 동작, 사용자 결정). 화면 확인은 로컬 `npm run dev:mock`으로 한다.

## 순서

1. PostgreSQL 생성, db-setup.sql 실행, 백업 설정
2. 서비스 3개 생성(Config File 칸은 비운다)·콘솔 설정 네 항목·변수 입력 → 배포 → 헬스체크 통과 확인
3. api-gateway 공개 도메인 생성 → 도메인을 vercel.json에 반영해 커밋
4. Vercel 프로젝트 생성·변수 입력 → 운영 도메인을 gateway `ALLOWED_ORIGINS`에 넣고 재배포
5. 검증: Gateway 도메인 직접 호출 404, Vercel 경유 `/api` 동작, `/api` 응답의 `x-vercel-cache`가 HIT가 아님, 응답 크기·30초 제한, 로그 보관 기간·크래시 알림·백업 설정값 기록

## 검증 결과 (2026-10-05)

| 항목 | 결과 |
|---|---|
| Gateway 공개 도메인 | `api-gateway-production-9d89.up.railway.app` (대상 포트 8080) |
| Vercel 운영 도메인 | `project-7qtt1.vercel.app`, 이후 `wy-worklog.com` 추가(D-55) |
| Gateway 직접 호출 | 404. 공개되는 actuator는 `/actuator/health`(상세 없이 status만)뿐이고 `/actuator`·`/actuator/env` 등은 404 |
| Vercel 경유 `/api` | `/api/worklog/health` → 401 problem+json (비밀 헤더 통과) |
| `x-vercel-cache` | MISS |
| Origin 검사 | 운영 Origin 통과, 다른 Origin의 쓰기 요청 403. wy-worklog.com 추가 후 curl: `https://wy-worklog.com` 통과, `https://www.wy-worklog.com`·다른 Origin 403 |
| 응답 크기·30초 제한 | 미측정 |
| 로그 보관 | 30일 (Pro 플랜 "30-Day Log History", Hobby면 7일) |
| 크래시 알림 | 계정 단위 Notification Rules(All Projects): Deployment Failed, Deployment Crashed / Oom Killed, Usage Alert, Workspace·Service·Domain Restricted, Fallback(High Severity, Notice) 모두 Email & In-App |
| 백업 | Volume backups Daily, 보관 6일, PITR 미사용. 첫 백업 2026-10-05 21:41 KST 무렵 일정대로 자동 실행(938 MB) |

### 도메인 전환 재검증 (D-55)

qa 시트 "도메인 전환 재검증"(DOM-01~10, [docs/qa/P0-화면테스트_v1.0.xlsx](../../docs/qa/P0-화면테스트_v1.0.xlsx)) 10건 PASS, 결함 없음.

| 항목 | 결과 |
|---|---|
| 인증 흐름 (wy-worklog.com) | 가입 201 → 로그인 200 → `/api/users/me` 200. 새로고침·새 탭에서 유지, access 만료 뒤 자동 갱신(me 401 → refresh 204 → me 200) |
| 쿠키 | HttpOnly·Secure·SameSite=Strict, Domain 속성 없음(host-only) |
| 리디렉션 | www·http → apex https 308 (경로·쿼리·POST `/api/*` 유지), HSTS 있음 |
| Origin 검사 | evil·www·http·Origin 없음 → 403. 기존 `project-7qtt1.vercel.app`은 통과(전환 기간, 기존 도메인을 내릴 때 `ALLOWED_ORIGINS`에서 뺀다) |
| `x-vercel-cache` | API 응답 MISS (정적 `/`는 HIT, 정상) |
| 기존 도메인 | 로그인 계속 동작, 세션은 도메인별로 따로 |

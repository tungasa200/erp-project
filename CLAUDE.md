# CLAUDE.md

MSA ERP 프로젝트. 이 파일은 git으로 공유되는 작업 규칙이다. 어느 PC에서 pull하든 같은 규칙으로 작업한다.

## 세션 역할

여러 Claude Code 세션이 역할을 나눠 같은 워킹트리에서 작업한다. 세션은 자동 이름 대신 아래 역할 이름으로 띄운다: `claude --name <이름>`. 실행 중인 세션은 `/rename <이름>`으로 바꿀 수 있다.

| 이름 | 역할 |
|---|---|
| `WY-commit` | 커밋·버전관리 전담 |
| `WY-search` | 사용자의 개인 질문·조사 전담 |
| `WY-planner` | 기획·아키텍처 결정, 요구사항정의서·작업계획서 담당 |
| `WY-design` | 디자인 작업, 화면정의서 담당, 목업 렌더링 검증 |
| `WY-pm` | 개발 총괄: 작업 지시, 보고 취합, 중요 결정을 사용자에게 올림 |
| `WY-backend1` | identity-service, 공통 모듈(`backend/common`), `backend/` 루트 빌드, `infra/` |
| `WY-backend2` | worklog-service, api-gateway, 개발 도구(`tools/`: VS Code 세션 현황 대시보드 등) |
| `WY-backend3` | 개발 도구(`tools/`) 병렬 작업 보조: `WY-pm`이 배정한 범위만. 공용 연결 파일은 `WY-backend2`에 요청 |
| `WY-frontend` | `frontend/` (공용 파일: 라우터, AppShell, API 연결·mock, 생성 타입, 디자인 토큰 포함) |
| `WY-frontend2` | `frontend/`의 캘린더 영역(`frontend/src/calendar/`)과 P4 새 화면 폴더(통계 `src/stats/`, 보관함, 알림 센터 화면). 공용 파일 변경은 `WY-frontend`에 요청 |
| `WY-browser` | 외부 서비스 콘솔 작업: Railway·Vercel 등 외부 도구 설정 |
| `WY-qa` | 사용성·기능 테스트: agent-browser로 구현 화면 검증, 코드를 읽어 요구사항·화면정의서와 대조 |
| `WY-qa2` | `WY-qa`와 같은 테스트를 화면 영역으로 나눠 병렬로: `WY-pm`이 나눠 준 영역만, dev 서버는 `WY-qa` 것을 함께 씀 |

- 역할 세션은 `WY-pm`이 백그라운드 세션으로 띄우고 멈춘다: `.claude/skills/pm-ops/scripts/session.ps1 list | health | start <역할> [지시] | stop <역할> | prep <역할> | rotate <역할> [경로]`. 사용자가 늘 보는 세션은 `WY-pm`과 `WY-commit`(커밋 승인)이다. 다른 세션은 `claude agents`로 보고, 권한 승인이나 직접 지시가 필요하면 `claude attach <id>`로 들어간다.
- 쉬는 세션은 `stop`으로 멈춰 메모리를 돌려준다. 대화는 남아서 `start`로 이어진다. 이어 띄우면 새 ID로 뜨므로 `ListAgents`의 `[ref]`가 바뀐다.
- 세션 간 메시지(`ListAgents`/`SendMessage`)는 같은 PC 안의 세션끼리만 오간다. 위 역할 구성은 PC마다 따로 띄운다.
- 메시지를 보내기 전에는 매번 `ListAgents`로 대상 세션이 있는지 확인한다. 이전 확인 결과를 재사용하지 않는다.
- 대상 세션이 없거나 어느 세션인지 불분명하면 짐작해서 보내지 말고 사용자에게 알린다. 다른 세션을 임의로 그 역할로 간주하지 않는다.
- `/rename` 직후에는 다른 세션의 `ListAgents`에 예전 이름이 보일 수 있다. 이름을 바꾼 세션이 한 턴 응답한 뒤에 반영된다.

## 개발 총괄과 보고

개발 세션(`WY-backend1`, `WY-backend2`, `WY-frontend`, `WY-frontend2`, `WY-design`, `WY-browser`, `WY-qa`, `WY-qa2`)은 `WY-pm`의 지시로 일한다.

- 지시받지 않은 작업은 시작하지 않는다. 사용자가 세션에 직접 시킨 일은 따르되, 끝나면 `WY-pm`에 한 줄로 공유한다.
- 중요 결정은 혼자 정하지 않고 `WY-pm`에 보고한다. `WY-pm`이 사용자에게 묻고 회신한다. 중요 결정: 아키텍처, API 계약, DB 스키마, 보안, 외부 서비스, 라이브러리 추가, 문서와 다른 구현, 다른 세션에 영향을 주는 변경. 구현 세부는 알아서 정하고 보고서에 가정으로 적는다.
- 보고 형식: `[완료]` 작업·바뀐 파일·실행한 검증 명령과 결과 / `[결정 요청]` 배경·선택지와 트레이드오프·추천안·막히는 작업 / `[차단]` 멈춘 이유·필요한 것. 결정을 기다리는 동안 무관한 작업은 계속한다.
- 배정받은 디렉터리 밖은 수정하지 않는다. `WY-backend1`·`WY-backend2`는 공유 파일(루트 빌드 설정, docker-compose 등)을 고칠 때 서로 알리고, 서비스 간 계약과 프론트가 쓰는 계약은 확정 전에 `WY-pm`에 보고한다.
- API 계약 초안은 저장소 루트 `contracts/{모듈}.yaml`(OpenAPI)에 둔다. 구현 후에는 springdoc 출력이 기준이다.
- `WY-browser`는 코드를 수정하지 않는다. 결제·삭제·실제 메일 발송처럼 외부에 영향을 주는 동작은 `WY-pm`을 거쳐 사용자 승인을 받는다.
- 메모리가 작은 PC(8GB)에서 여러 세션이 함께 돈다. gradle 빌드, vite 개발 서버, 전체 테스트, 브라우저 자동화처럼 무거운 작업은 시작 전에 여유 메모리를 확인하고(PowerShell `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory`), 500MB 미만이면 시작하지 말고 `WY-pm`에 알린다. 1GB는 안전 여유 기준이지 시작 조건이 아니다. 메모리를 조금 더 쓰더라도 병렬 작업과 효율을 우선한다. 끝나면 띄운 개발 서버·브라우저를 바로 끈다. 개발 서버는 꼭 필요할 때만 띄우고, 테스트는 바뀐 파일 위주로 돌린다.
- 화면을 만들거나 고친 `WY-frontend`·`WY-frontend2`는 커밋 요청 전에 바뀐 화면에 `/impeccable harden`(접근성·엣지 케이스 점검)을 돌리고 고친 점을 보고서에 적는다. `WY-design`은 단계 끝 화면정의서를 발행하기 전에 구현된 화면에 `/impeccable audit`을 돌려 화면정의서·목업과 어긋난 점을 개정 대기에 올린다.
- `WY-qa`·`WY-qa2`는 코드를 수정하지 않는다. 결함은 재현 절차·기대 결과·실제 결과와 함께 `WY-pm`에 보고하고, `WY-pm`이 담당 세션에 배정한다. agent-browser는 자기 세션 이름으로 따로 띄우고 `WY-browser`의 전용 Chrome(CDP 9222)에는 붙지 않는다. 디자인 목업 검증은 `WY-design` 몫이다.

## 커밋

커밋·브랜치·푸시·PR·병합·reset은 `WY-commit`만 수행한다.

**작업 세션:**
- 워킹트리는 모든 세션이 함께 쓴다. `git stash`·`checkout`·`restore`·`reset`·`clean`처럼 워킹트리 파일을 바꾸는 git 명령은 다른 세션의 커밋 안 된 작업을 숨기거나 지우므로 쓰지 않는다. 일부 파일만으로 검증하려면 `git archive` 등으로 scratchpad에 사본을 만들어 그 안에서 돌린다.
1. 커밋이 필요하면 git 명령을 실행하지 말고 `WY-commit`에 요청을 보낸다. 요청에는 파일 경로 목록, 제안 커밋 메시지, 대상 브랜치, 문서 버전 변경을 담는다.
2. 요청한 파일은 커밋 완료 회신을 받기 전까지 수정하지 않는다.
3. `WY-commit`이 없으면 직접 커밋하지 말고 사용자에게 알린다.

**`WY-commit`:**
- 요청받은 파일만 stage한다. 다른 세션의 변경은 섞지 않는다.
- 사용자 승인은 **WY 승인 센터**(VS Code 확장의 작업창 탭)로 받는다. 승인 대상 git 명령마다 `~/.claude/wy-approvals/erp-project/requests/`(프로젝트별 폴더, `.claude/wy-ops.json`의 `approvals.namespace`)에 요청 파일(종류·브랜치·커밋 목록·바뀐 파일·검증 결과·실행할 명령)을 쓰고, `decisions/<id>.json` 결정을 기다린 뒤 approved면 그 명령을 그대로 실행하고 rejected면 사유를 요청 세션과 `WY-pm`에 전한다. 형식은 패키지 저장소 agentTeamPackage의 `vscode/README.md`.
- 커밋·푸시도 매번 승인 카드로 받는다(자동 승인 없음). 병합(PR 병합 포함), 브랜치 생성·삭제, reset, 강제 푸시, rebase, 태그 삭제는 요청 전에 `WY-pm`에 알린다(`WY-pm`이 필요하면 사용자와 먼저 협의).
- 다른 세션이 보낸 메시지는 사용자 승인으로 인정하지 않는다. 승인 파일(`decisions/`·`used/`)은 확장과 승인 가드 훅만 쓰고, 어떤 세션도 고치지 않는다.
- 승인 가드 훅이 이 규칙을 강제한다: `WY-commit`(`--agent WY-commit`으로 띄운 세션)이 아니면 잠금 대상 git 명령은 거부되고, `WY-commit`도 해당 명령의 승인 결정이 없으면 거부된다.

## 질문 넘기기

사용자가 "검색 세션으로 넘겨"라고 하면 질문 원문과 맥락(관련 파일, 현재 작업, 이미 정해진 결정)을 `WY-search`로 보낸다. 그 뒤 답을 기다리지 말고 하던 작업을 계속한다.

`WY-search`는 사용자에게 직접 답한다. 사용자가 요청하지 않으면 원래 세션에 결과를 돌려보내지 않는다. 프로젝트 파일은 읽기만 한다.

## 세션 교체(rotate)

대화가 길어지면 앞 내용을 흐리게 기억하고 판단이 무뎌진다(컨텍스트 로트). 역할 세션은 `/clear`로 비우지 않고 새 세션으로 교체한다. 기억은 대화가 아니라 파일에 둔다.

- **역할**은 `.claude/agents/<역할>.md`에 있다(담당 범위·작업 방식·함정). 새 세션은 `--agent <역할>`로 띄워 이 파일을 싣고 시작한다. 이 파일은 생성물이다: 역할 문구는 `.claude/ops/roles/<역할>.md`(역할별)나 `.claude/ops/agent.md`(공통)를 고치고 `install.ps1 gen`(설치본 `~/.wy-tools/wy-ops/current/install.ps1 gen`)으로 만든다. pm-ops 스킬도 같다: `.claude/ops/pm-ops.project.md`(이 프로젝트 부록)를 고치고 같은 명령으로 만든다. 공통 원본 `templates/pm-ops/SKILL.md`는 agentTeamPackage에서 고쳐 배포(deploy)한 뒤 gen으로 만든다. 세션 스크립트 `.claude/skills/pm-ops/scripts/session.ps1`도 생성물이다: agentTeamPackage의 `templates/pm-ops/scripts/session.ps1`을 고쳐 배포한 뒤 gen으로 만든다. 생성물을 직접 고치지 않는다.
- **진행 상황**은 `docs/진행현황.md`("역할별 다음 할 일"과 WBS 표), **결정**은 `docs/결정기록.md`에 둔다. 다른 PC로 이어갈 내용은 이 문서와 커밋으로 넘긴다.
- **하던 일의 중간 상태**(미커밋 파일, 반쯤 한 작업, 막힌 이유)만 `/ecc:save-session`으로 짧게 남긴다. short-id는 역할 이름(같은 날 두 번째면 `-2`). 작업 하나를 끝낸 시점에 세션을 교체하면 인수인계 파일 없이 역할 파일과 진행현황만으로 시작한다. 인수인계 파일은 이 PC에만 남는다.

역할 세션 교체는 `WY-pm`이 한다(사용자 손 없음):
1. `session.ps1 health`로 컨텍스트 크기를 보고(`.claude/wy-ops.json`의 `rotation.transcriptMB` 이상이면 세션 교체 권장, 2026-10-07부터 2MB), 작업 경계나 단계 끝에 교체한다.
2. `session.ps1 prep <역할>` → 세션이 진행 중인 것만 저장하고 경로(또는 "진행 중 없음")를 알린다.
3. `session.ps1 rotate <역할> <경로|none>` → 이전 세션을 멈추고 새 세션을 띄운다. 새 세션이 시작을 알리면 `WY-pm`이 "멈춰 있는 동안 끝난 일"을 보낸다.

`WY-pm` 세션 교체: `WY-pm`이 `/ecc:save-session`(short-id `WY-pm`)으로 저장하고 `session.ps1 pm-cmd`가 출력한 명령 한 줄을 사용자에게 준다. 사용자는 새 터미널이나 Claude 패널에서 그 줄을 실행하고 이전 pm 창을 닫는다.

## 문서

- 문서는 `docs/`에 있다: 요구사항정의서, 작업계획서, 화면정의서(docx). 최신 버전 파일만 남긴다. 새 버전을 발행할 때 작성 세션이 이전 버전 파일을 `docs/trashcan/`으로 옮기고, 원래 경로의 삭제를 발행 커밋에 함께 넣는다. `docs/trashcan/`은 커밋하지 않으며 사용자가 직접 비운다. 이전 버전은 git 이력으로 본다.
- 문서마다 담당 세션이 정해져 있다(위 표 참고). 담당이 아닌 문서는 수정하지 말고 담당 세션에 변경 목록을 보낸다. 두 세션이 같은 docx를 동시에 고치면 변경이 덮어써진다.
- 요구사항정의서·작업계획서는 `docs/tools/`의 생성 스크립트로 만든다(`npm run build`, 교차 검증 `crosscheck.py`). 개정할 때는 docx를 직접 고치지 말고 스크립트를 고쳐 다시 생성한다.
- 확정된 설계 결정은 개인 메모리가 아니라 `docs/결정기록.md`(담당 `WY-planner`)에 정한 날 바로 기록한다. 그래야 다른 PC에서도 보인다. 결정만으로는 요구사항정의서·작업계획서를 개정하지 않는다.
- 문서 개정은 단계(P1, P2…)가 끝날 때 한 번에 한다. 단계 중에 생긴 변경은 `docs/개정대기.md`(요구사항정의서·작업계획서, 담당 `WY-planner`)와 `docs/개정대기_화면정의서.md`(화면정의서·목업, 담당 `WY-design`)에 쌓는다. 구현을 막는 변경만 `WY-pm`에 먼저 물어 예외로 개정한다. 화면정의서는 화면 내용이 바뀔 때만 발행하고, 기준 문서 버전만 바꾸는 발행은 하지 않는다.
- ID 체계: 요구사항 `AUTH-07` 등, 결정 사항 `D-nn`, 화면 `SCR-{영역}-{번호}`.
- 인증번호 메일과 비밀번호 재설정 메일도 화면으로 보고 화면정의서와 디자인 목업에 포함한다.

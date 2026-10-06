# 운영 도구 패키지화 계획 (확정)

작성: WY-backend2, 2026-10-07. 상태: **확정**(2026-10-07 사용자 결정, 7장). 패키지 이름: `wy-ops`. 진행:
- 1단계 완료(f8b6cfa): `.claude/wy-ops.json` 추가.
- 2단계 완료(324eab0, 설치본 v0.3.0): session.ps1·대시보드·가드 훅이 설정을 읽고, 없으면 지금 값으로 대체.
- 4단계 완료(52fb94d): `tools/wy-ops/gen-agents.js` + `.claude/ops/agent.md`·`roles/*.md` → 역할 파일 10개와 글자 단위로 같음(CRLF 체크아웃 포함). 역할 문구의 원본은 이제 `.claude/ops/`(WY-pm 결정, 2026-10-07).
- 3단계 완료(c1f343c, 설치본 v0.4.0 배포로 전환): 승인 폴더 `~/.claude/wy-approvals/erp-project/`, 가드 훅이 cwd의 프로젝트 폴더를 쓰고 설정 파일 3개의 셸 쓰기를 막음.
- 5단계 완료(커밋 대기, WY-pm 승인): pm-ops를 코어 템플릿(`tools/wy-ops/templates/pm-ops/SKILL.md`)과 프로젝트 부록(`.claude/ops/pm-ops.project.md`)으로 나누고 `tools/wy-ops/gen-skill.js`가 합쳐 `.claude/skills/pm-ops/SKILL.md`를 만든다. 앞으로 pm-ops 문구는 부록·코어 템플릿을 고치고 생성한다.
- 다음: 6단계(패키지 추출·install.ps1·확장 id 변경), 7단계(시험 프로젝트). **보류(OPS-07, 2026-10-07 사용자 결정)**: 운영 도구 OPS-01~06이 안정된 뒤 다시 시작한다. 6단계 도중의 미커밋 변경은 되돌려 백업(`C:\projects\erp-project-wyops6-backup\`)에 두었고, 다시 시작할 때 그 시점의 HEAD에서 이동을 새로 한다(tools/OPS-IMPL-PLAN.md 6장).

목표: erp-project에 묶인 운영 도구(세션 현황 대시보드·WY 승인 센터, session.ps1·pm-ops 스킬, 역할 파일, 승인 가드 훅과 승인 규약)를 다른 프로젝트에도 설치해 쓰는 패키지 하나로 만든다. 이 프로젝트는 옮기는 동안 계속 지금처럼 돌아가야 한다.

## 1. 지금 상태와 하드코딩 목록

| 위치 | 고정된 값 | 옮길 곳 |
|---|---|---|
| `session.ps1` | `$Repo = C:\projects\erp-project` | 실행 위치에서 계산(스크립트가 있는 저장소 = `git rev-parse --show-toplevel`) |
| | `$Roles` 10개, `WY-pm` | 프로젝트 설정 `roles`, `pmRole` |
| | `$OldNames`(이름 변경 전 이름) | 프로젝트 설정 `handoff.oldNames`(선택) |
| | `$RotateMB = 5` | 프로젝트 설정 `rotation.transcriptMB` |
| | `$Transcripts = …\.claude\projects\c--projects-erp-project` | 저장소 경로에서 계산: 영문·숫자 외 문자를 `-`로(Windows는 대소문자 무시) |
| | 지시 문구 속 `WY-pm`, `docs/진행현황.md`, `/ecc:resume-session` | 설정의 `pmRole`·`docs.progress`, ecc 의존은 설치 때 확인 |
| `extension.js` | 역할 순서를 `CLAUDE.md`의 '## 세션 역할' 표에서 파싱 | 프로젝트 설정 `roles` 순서(없으면 지금 방식으로 대체) |
| `package.json` | 확장 이름 `erp-session-dashboard`, 표시 이름 'ERP 세션 현황', 뷰 id `erpSessions.*` | 제품 중립 이름(7장 D5) |
| `approvalStore.js` | 승인 폴더 `~/.claude/wy-approvals`(PC 전체에 하나) | 프로젝트별 하위 폴더(7장 D2) |
| `wy-approval-guard.js` | `COMMIT_SESSION = 'WY-commit'`, 보호 경로, 60분 | 훅 입력의 `cwd`에서 프로젝트 설정을 찾아 `commitRole`·`approvals` 사용 |
| `deploy.js` | 설치 폴더 `~/.wy-tools/vscode-dashboard` | 패키지 설치 폴더(3장) |
| `.claude/settings.local.json` | 훅 경로 `C:/Users/ksoun/.wy-tools/…`(개인 절대경로), deny 4줄 | 설치 스크립트가 생성·병합 |
| `.claude/agents/WY-*.md` 10개 | 머리말 "erp-project(제품명 WY, 서비스 worklog)", 역할 이름, 공통 블록 10번 반복 | 템플릿(공통 블록 1개 + 역할별 블록)에서 생성 |
| `.claude/skills/pm-ops/SKILL.md` | WY 역할 이름, docs 경로, D-54, 비밀값 경로, impeccable 지시, 8GB 기준 | 공통 코어 스킬 + 프로젝트 부록 파일 |
| `CLAUDE.md` | '세션 역할' 표, '커밋'·'세션 교대' 절 | 공통 절은 패키지 조각 파일을 `@import`, 역할 표는 프로젝트가 소유 |

외부 의존: Claude Code CLI(`claude agents --json`, `--bg`, `--agent`), ecc 플러그인(`save-session`/`resume-session`), Node(훅·배포), VS Code 1.85+.

## 2. 프로젝트별 설정 파일

두 파일로 나눈다(D7).

- `.claude/wy-ops.json` — 저장소에 커밋. 모든 PC가 같은 값.
- `.claude/wy-ops.local.json` — gitignore. 이 PC만의 값(메모리 기준 등). 같은 키를 덮어쓴다.

```json
{
  "schema": 1,
  "project": "erp-project",
  "product": "WY",
  "rolePrefix": "WY-",
  "pmRole": "WY-pm",
  "commitRole": "WY-commit",
  "roles": [
    { "name": "WY-commit", "summary": "커밋·버전관리 전담", "agent": true },
    { "name": "WY-search", "summary": "사용자의 개인 질문·조사 전담", "agent": true },
    { "name": "WY-planner", "summary": "기획·아키텍처 결정, 요구사항정의서·작업계획서", "agent": true },
    { "name": "WY-pm", "summary": "개발 총괄", "agent": false }
  ],
  "rotation": { "transcriptMB": 5 },
  "memory": { "warnFreeMB": 1024, "blockFreeMB": 500 },
  "approvals": { "namespace": "erp-project", "ttlMinutes": 60 },
  "docs": { "progress": "docs/진행현황.md", "decisions": "docs/결정기록.md" },
  "handoff": { "oldNames": { "WY-commit": "erp-commit" } }
}
```

- `roles` 순서가 대시보드 정렬 순서다. `agent: false`면 역할 파일을 만들지 않는다(WY-pm은 대화형).
- 역할별 '작업 방식' 본문은 설정이 아니라 `.claude/ops/roles/<역할>.md`(프로젝트 소유 마크다운)에 둔다. 생성기가 공통 블록과 합쳐 `.claude/agents/<역할>.md`를 만든다.
- 저장소 경로, 대화 기록 폴더, 설치 폴더는 설정에 적지 않고 계산한다.

## 3. 패키지 구조

```
wy-ops/                      패키지 저장소(위치는 D1)
  package.json               버전 하나로 전체를 묶음
  core/
    vscode/                  대시보드·승인 센터 확장(지금 tools/vscode-dashboard)
    hooks/approval-guard.js  가드 훅(프로젝트 설정을 cwd에서 찾음)
    lib/approvalStore.js     요청·결정 규약(확장과 훅이 공유)
    ps/WyOps.psm1            session.ps1의 공통 함수(설정 읽기, 세션 목록, 교대)
    ps/session.ps1           얇은 진입점: WyOps.psm1을 불러 명령 실행
    skills/pm-ops/SKILL.md   공통 운영 절차(제품 이름·경로는 설정 참조로)
    claude/ops-rules.md      CLAUDE.md에 @import할 공통 절(커밋·세션 교대·보고 형식)
  templates/
    wy-ops.json              새 프로젝트 기본 설정
    agent-common.md          역할 파일 공통 블록({{project}}, {{pmRole}} 자리표시자)
    roles/                   역할 예시(commit, planner, backend, frontend, qa, …)
  install.ps1                설치·마이그레이션·업데이트·제거
  README.md
```

설치 위치(PC 공통): `~/.wy-tools/<버전>/`에 풀고 `~/.wy-tools/current`를 그 버전을 가리키는 정션으로 둔다. VS Code 확장과 훅은 `current` 경로를 쓰므로 버전을 바꿔도 재설치가 필요 없고, 정션만 되돌리면 롤백된다(정션은 관리자 권한 없이 만들 수 있다).

프로젝트에 남는 것: `.claude/wy-ops.json`(+local), `.claude/ops/roles/*.md`, 생성된 `.claude/agents/*.md`, `.claude/skills/pm-ops/`(코어 사본 + `project.md` 부록), `.claude/settings.local.json`의 훅·deny 조각, `CLAUDE.md`의 `@.claude/ops/ops-rules.md` 한 줄, `.claude/wy-ops.lock.json`(생성 파일 해시, 업데이트 때 손댄 파일을 덮지 않으려고).

## 4. 설치 스크립트 흐름 (Windows PowerShell 5.1)

`powershell -ExecutionPolicy Bypass -File install.ps1 <명령>`

- **`global`**: 패키지를 `~/.wy-tools/<버전>`에 복사 → `current` 정션 교체 → 처음이면 VS Code 확장 설치 안내(Install from Location에서 `~/.wy-tools/current/vscode`, 한 번만).
- **`init -Project <경로> [-Prefix XX-] [-Roles …]`**(새 프로젝트): `wy-ops.json` 생성(질문 또는 인자) → 역할 템플릿 복사 → `agents/*.md` 생성 → pm-ops 스킬 복사 → `settings.local.json`에 훅·deny 병합(기존 키 보존) → `.gitignore`에 local·lock 추가 → `CLAUDE.md`에 넣을 `@import` 줄과 역할 표를 출력(자동 수정은 하지 않음) → `doctor`.
- **`migrate -Project <경로>`**(이 프로젝트): 지금 파일에서 설정을 역추출 → 생성 결과를 지금 파일과 비교해 **차이만 보여 주고**, `-Apply`일 때만 쓴다.
- **`update`**: `global` 후 각 프로젝트에서 생성 파일을 다시 만든다. lock 해시와 다르면(사람이 고침) 덮지 않고 diff만 보여 준다.
- **`doctor`**: claude·node·ecc 플러그인, 확장 설치 위치, 훅 경로 존재(없으면 훅이 '통과'로 실패하므로 가장 중요), 승인 폴더, 설정 스키마를 점검한다.
- **`uninstall -Project`**: 훅·deny 조각과 생성 파일 제거(lock에 있는 것만).

PowerShell 5.1 함정(지금 session.ps1에서 겪은 것 포함):
- 한글이 든 .ps1은 **BOM 있는 UTF-8**로 저장해야 한다(없으면 ANSI로 읽어 깨짐). 생성하는 JSON·md는 BOM 없이 `[IO.File]::WriteAllText($p, $s, (New-Object Text.UTF8Encoding $false))`.
- `ConvertTo-Json`은 기본 깊이 2라 `-Depth 20` 필수, `ConvertFrom-Json` 배열 풀림 주의, `-AsHashtable` 없음(PSCustomObject 병합 함수를 따로 만든다).
- `$ErrorActionPreference='Stop'`이면 claude.exe의 stderr 출력으로 끊긴다(지금 'Continue'로 둔 이유).
- npm의 `claude.ps1`은 실행 정책에 막히므로 `claude.cmd`로 부른다. 큰따옴표 인자 전달 문제는 작은따옴표로 바꾼다.

## 5. 이 프로젝트를 깨지 않고 옮기는 순서

원칙: 단계마다 커밋 1개 → `deploy.js`(또는 이후 `install.ps1 global`) → Reload Window → 검증. 각 단계는 앞 단계로 바로 되돌릴 수 있다. 승인 대기열이 비어 있을 때 진행한다.

| 단계 | 내용 | 검증 | 담당 |
|---|---|---|---|
| 1 | `.claude/wy-ops.json`을 지금 값 그대로 추가(아직 아무도 안 읽음) | JSON 검사, 동작 변화 없음 | pm 파일(작성은 backend2 초안) |
| 2 | 확장·훅·session.ps1이 설정을 읽게 바꿈. **설정이 없으면 지금 하드코딩 값으로 대체** | 가짜 vscode·훅 테스트, `session.ps1 list/health` 출력이 바꾸기 전과 같음, 승인 카드 1회 왕복 | backend2(tools), pm(session.ps1) |
| 3 | 승인 폴더를 `~/.claude/wy-approvals/erp-project/`로 이전. 확장은 옛 루트와 새 폴더를 한동안 둘 다 읽고, 대기열이 빈 시점에 훅·규약을 새 폴더로 전환 | 테스트 요청 카드 왕복, 옛 폴더에 새 파일이 생기지 않음 | backend2, WY-commit 규약 갱신 |
| 4 | 역할 파일 생성기 도입: 공통 블록 + `.claude/ops/roles/*.md` → `agents/*.md`. 공통 블록의 메모리 줄은 2026-10-07 규칙(500MB 미만이면 시작 금지, 1GB는 안전 여유, 병렬·효율 우선 — CLAUDE.md 40행)을 기준으로 하고 값은 `memory.blockFreeMB`·`warnFreeMB`에서 채운다 | 생성 결과가 그때의 10개 파일과 **글자 단위로 같음**(다르면 의도한 차이만) | pm 소유 파일 |
| 5 | pm-ops 스킬을 코어(공통)와 `project.md`(이 프로젝트 부록: docs 경로, D-54, 비밀값 위치, impeccable 지시)로 분리 | pm이 새 세션에서 스킬을 불러 같은 절차를 따르는지 확인 | pm 소유 |
| 6 | 패키지 저장소로 추출 + `install.ps1`. 이 프로젝트에 `migrate`(차이 확인) → `-Apply` | diff 없음, `doctor` 통과, 훅 경로가 `~/.wy-tools/current/…`로 바뀐 뒤 승인 카드 왕복 | backend2 |
| 7 | 시험용 새 프로젝트(예: `C:\projects\ops-sandbox`)에 `init` → 세션 하나 띄우기, choice 결정 1회, 승인 1회 | 끝까지 동작, 두 프로젝트의 승인 대기열이 섞이지 않음 | backend2 + 사용자 확인 |

훅 경로를 바꾸는 단계(6)는 **새 경로에 파일이 있는 것을 `doctor`로 확인한 뒤** settings를 바꾼다. 경로가 없으면 훅이 조용히 통과하기 때문이다.

## 6. 작업량(대략)

| 묶음 | 분량 |
|---|---|
| 1~2단계 설정 읽기 + 대체값 + 테스트 | 작업 세션 1일 |
| 3단계 승인 폴더 이전 | 0.5일 |
| 4단계 역할 파일 생성기 | 0.5일 |
| 5단계 스킬 분리 | 0.5일(pm 검토 포함) |
| 6단계 패키지 추출 + install.ps1(병합·정션·lock·doctor) | 1.5일 |
| 7단계 시험 프로젝트 + README | 0.5~1일 |
| 합계 | 약 4.5~5일(세션 교대 2~3회), 사용자 손: 확장 재설치 1회(D5를 바꿀 때), 단계별 커밋 승인 |

## 7. 결정 (2026-10-07 확정)

| 항목 | 결정 |
|---|---|
| D1 패키지 위치 | A — 이 저장소 `tools/`에서 일반화(1~5단계), 6단계에서 별도 저장소로 추출 |
| D2 승인 대기열 | A — 프로젝트별 하위 폴더 `~/.claude/wy-approvals/<namespace>/` |
| D3 역할 목록 원본 | A — `.claude/wy-ops.json` |
| D4 프로젝트 반영 | A — 설치 스크립트가 `.claude/`에 생성·복사, 커밋 |
| D5 이름 | 패키지 `wy-ops`. 확장 id·뷰 id는 6단계에서 한 번에 변경 |
| D6 인수인계 | A — ecc save/resume-session 유지, `doctor`가 확인 |
| D7 설정 분리 | `wy-ops.json`(커밋) + `wy-ops.local.json`(gitignore) |
| D8 소유권 | 코드(모듈화·생성기·설치 스크립트)는 WY-backend2, 내용(역할 본문·스킬 문구·CLAUDE.md)은 WY-pm 검토·승인 |

아래는 결정 당시의 선택지와 대가(기록용).

**D1 패키지를 어디에 둘까**
- A. 이 저장소 `tools/`에서 일반화(1~5단계)한 뒤, 6단계에서 별도 저장소로 추출 **(추천)** — 지금 커밋·승인 흐름을 그대로 쓰고, 두 번째 프로젝트가 생길 때 떼어 낸다. 대가: 추출 때 이력이 한 번 끊긴다(필요하면 `git subtree split`으로 보존).
- B. 처음부터 별도 저장소(예: `C:\projects\wy-ops`, GitHub 비공개) — 경계가 깔끔하다. 대가: 그 저장소의 커밋·승인 흐름(WY-commit·가드)을 따로 정해야 하고, 두 저장소를 오가며 맞춰야 한다.
- C. Claude Code 플러그인(로컬 마켓플레이스)으로 스킬·훅을 배포하고 VS Code 확장은 따로 — 설치·업데이트가 `/plugin`으로 표준화된다. 대가: 프로젝트별 켜기·역할 파일 생성은 여전히 필요하고, 플러그인 훅의 프로젝트 범위 동작을 먼저 검증해야 한다(문서 확인 필요). 6단계 이후 재검토 권장.

**D2 승인 대기열을 프로젝트별로 나눌까**
- A. 프로젝트별 하위 폴더 `~/.claude/wy-approvals/<namespace>/` **(추천)** — 다른 프로젝트의 승인을 소모할 위험이 없다(같은 `git push origin main` 문자열도 안전). 대가: 승인 센터 탭이 지금 창의 프로젝트만 보여 준다(다른 프로젝트 대기 수는 상태 표시줄에 합산해 보여 줄 수 있음).
- B. 한 대기열 + 요청·결정에 `project` 필드, 훅은 cwd의 프로젝트와 맞는 결정만 사용 — 탭 하나로 전 프로젝트를 처리한다. 대가: 검사 조건이 늘어 실수 여지가 커진다.
- C. 지금처럼 전역 하나 — 프로젝트가 둘이 되는 순간 섞인다(비추천).

**D3 역할 목록의 원본**
- A. `wy-ops.json`이 원본, CLAUDE.md 표는 사람이 읽는 설명(설치 스크립트가 표 초안을 출력) **(추천)** — 스크립트·확장·생성기가 한 곳을 본다. 대가: CLAUDE.md 표와 설정을 맞춰야 한다(`doctor`가 불일치 경고).
- B. 지금처럼 CLAUDE.md 표 파싱 — 문서 형식이 바뀌면 깨진다.

**D4 스킬·역할 파일·훅을 프로젝트에 넣는 방식**
- A. 설치 스크립트가 프로젝트 `.claude/`에 생성·복사(저장소에 커밋됨) **(추천)** — 다른 PC에서 pull만 하면 같은 규칙. 대가: 업데이트 때 재생성 필요(lock 해시로 손댄 파일 보호).
- B. 패키지 폴더를 참조만(복사 없음) — 업데이트가 즉시 반영된다. 대가: 패키지가 없는 PC에서는 역할 파일·스킬이 사라진다.

**D5 이름**
- 패키지 이름(예: `wy-ops`)과 확장 id. 지금 확장 id `erp-session-dashboard`·뷰 id `erpSessions`를 제품 중립 이름으로 바꾸려면 6단계에서 확장을 한 번 제거·재설치해야 하고 사이드바 배치가 초기화된다. **추천: 6단계에서 한 번에 바꾼다.**

**D6 인수인계 기능**
- A. ecc 플러그인의 save/resume-session을 계속 쓰고 `doctor`가 설치 여부를 확인 **(추천)** — 지금 흐름 그대로.
- B. 패키지에 최소 인수인계 스킬을 직접 넣음 — 의존이 줄지만 기능을 다시 만든다.

**D7 설정 파일 분리**
- 커밋되는 `wy-ops.json` + PC별 `wy-ops.local.json`(gitignore) **(추천)**. 메모리 기준처럼 PC마다 다른 값만 local에 둔다.

**D8 소유권(이 프로젝트 안)**
- `.claude/agents`, `.claude/skills/pm-ops`, `session.ps1`, `CLAUDE.md`는 지금 WY-pm 영역이다. 4·5단계와 session.ps1 변경을 누가 할지 정해야 한다. 추천: 코드(session.ps1 모듈화·생성기)는 WY-backend2가 맡고, 내용(역할 본문·스킬 문구·CLAUDE.md)은 WY-pm이 검토·승인한다.

## 8. 위험과 대응

- **설정 파일로 가드 우회**(2단계에서 생김): 가드 훅이 `commitRole`을 저장소의 `.claude/wy-ops.json`에서 읽으므로, 세션이 이 파일을 고치면 자기 이름을 커밋 세션으로 바꿀 수 있다. `.claude/settings.local.json`(훅 설정)을 고쳐 훅을 빼는 것과 같은 종류의 구멍이다. 대응: settings.local.json의 deny에 `Edit(/.claude/wy-ops.json)`, `Edit(/.claude/wy-ops.local.json)`, `Edit(/.claude/settings.local.json)`을 더한다(사용자 설정 변경). 대가: 이 파일들은 사람이 직접 고쳐야 한다. **2026-10-07 사용자 결정 A로 적용됨.** 남은 구멍: Edit 규칙은 Bash·PowerShell로 쓰는 것(node 스크립트, `Set-Content` 등)까지는 막지 못한다 → 3단계에서 가드 훅의 쓰기 차단 경로에 이 세 파일을 넣는 것을 검토한다(대가: 이 경로를 언급하는 node·powershell 명령은 읽기 목적이어도 막힌다).
- **역할 파일과 원본이 어긋남**(4단계 이후): 생성기를 도입한 뒤 누군가 `.claude/agents/*.md`를 직접 고치면 원본(`.claude/ops/`)과 달라진다 → 원본을 고치고 생성하는 것을 규칙으로 하고, `gen-agents.js --check`로 어긋남을 찾는다(커밋 전 WY-commit 점검 항목 후보).

- **훅이 조용히 통과**: 경로가 틀리거나 node가 없으면 Claude Code가 훅을 건너뛴다 → `doctor` 필수 점검, 경로 전환은 파일 확인 뒤.
- **승인 폴더 전환 중 대기 요청 유실**: 대기열이 빈 시점에 전환하고, 확장은 전환 기간 동안 옛 폴더도 읽는다.
- **생성 파일을 사람이 고친 경우 덮어쓰기**: lock 해시로 감지하고, 덮지 않고 diff만 보여 준다.
- **PowerShell 인코딩**: BOM 규칙을 설치 스크립트 테스트에 넣는다(한글 문구 왕복 확인).
- **여러 VS Code 창**: 확장 하나가 창마다 자기 워크스페이스의 설정·대기열을 보게 한다(설정이 없는 워크스페이스에서는 승인 센터를 끈다).

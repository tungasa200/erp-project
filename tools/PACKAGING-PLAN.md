# 운영 도구 패키지화 구현 계획 (OPS-10)

작성: WY-backend2, 2026-10-07. 상태: **확정**(2026-10-07 사용자 결정 K1~K4 모두 추천안, 승인 센터 1140. WY-planner의 OPS-10 대조 6건과 pm 결정 U-12·13·14 반영). 기준 요구사항: `docs/운영도구_요구사항.md` OPS-10(10-1·10-2·10-3), 6장(이 PC에만 있는 것)·8장(미결).

사용자 결정(2026-10-07, OPS-10):
- 개발 위치: 이 저장소 `tools/`에서 계속 개발한다. P4 이후 최종 마무리 뒤에 별도 저장소로 분리한다(U-06).
- 메모리 폴더: 옮기지 않는다. 기준은 CLAUDE.md·docs다(U-07).
- 사용자 전역 설정(`~/.claude/CLAUDE.md`, 사용자 스킬): 패키지에 넣지 않고 체크리스트로 안내한다(U-09).
- 지원 OS: Windows만 지원한다(U-10).

이전 계획(같은 파일, 2026-10-07 확정본)의 1~5단계는 끝났다. 끝난 것은 설정 파일 `.claude/wy-ops.json`, 설정 읽기, 프로젝트별 승인 폴더, 역할 파일 생성기, pm-ops 코어·부록 분리다. 그 계획의 결정 D1~D8 가운데 D1(위치)은 위 결정으로 바뀌었고, 나머지(D2 프로젝트별 승인 폴더, D3 역할 원본은 wy-ops.json, D4 생성·복사 후 커밋, D5 확장 id 변경, D6 ecc 인수인계, D7 설정 분리, D8 소유권)는 그대로 둔다. 이 문서는 6단계 이후를 R1~R7로 다시 짠다.

## 1. 조사 결과 (구현 전 확인)

### U-11 VS Code 확장 설치 방식 — 해소

- 지금 방식: "Install Extension from Location"이다. `~/.vscode/extensions/extensions.json`에 `erp-project.erp-session-dashboard`가 `source: "resource"`, 위치 `~/.wy-tools/vscode-dashboard`로 등록되어 있다. 그래서 설치본만 바꾸고 Reload하면 업데이트된다(기록된 버전은 0.2.0이지만 실제로는 0.5.0이 돈다).
- 명령줄: `code --install-extension <폴더>`는 안 된다("not found", 2026-10-07 시험). 폴더 위치 설치는 UI 명령에만 있다.
- npm 없이 만든 vsix: 됨. vsix는 zip 안에 `extension.vsixmanifest`, `[Content_Types].xml`, `extension/`이 든 형식이다. PowerShell의 .NET `ZipFile`로 만들고 `code --extensions-dir <임시> --install-extension x.vsix`로 설치해 목록에 뜨는 것을 확인했다. vsce·npm 의존성은 없다.
- 결론: 새 PC는 명령으로 확장을 설치할 수 있다. 다만 vsix 설치는 확장을 `~/.vscode/extensions`로 **복사**하므로, 그대로 쓰면 업데이트마다 다시 설치해야 한다. 이 문제는 9장 K1에서 정한다(추천: 껍데기 확장이 설치본을 불러오는 방식).

### U-08 플러그인 설치·버전 고정 — 해소(일부 조건부)

- 설치: `claude plugin install <이름>@<마켓플레이스> --scope user`. `--marketplace <소스>`를 주면 마켓플레이스 추가까지 한 번에 한다. 목록은 `claude plugin list --json`으로 읽는다(이름·버전·scope·enabled).
- 버전 고정: 마켓플레이스 소스에 git ref를 붙일 수 있다(`owner/repo#v1.2.0`, `https://…git#<ref>`, 공식 문서 install·marketplace-reference). 플러그인 하나만 고정하는 `source.ref`·`sha`는 marketplace.json 안에서 정하는 것이라, 남의 마켓플레이스에서는 우리가 정할 수 없다. 따라서 고정은 **마켓플레이스 단위 ref**로 한다.
- 자동 업데이트: 공식 마켓플레이스 밖의 마켓플레이스는 기본이 꺼짐이다. 지금 4개는 모두 외부 마켓플레이스다.
- 프로젝트 settings의 `extraKnownMarketplaces`·`enabledPlugins`: 선언은 할 수 있다. 하지만 다른 PC에서 자동으로 설치되지는 않는다(문서에 자동 설치·제안 동작이 없음). 그래서 설치 명령이 직접 설치한다.
- 이 PC의 사용자 범위 플러그인: ecc 2.2.2(마켓플레이스 git `https://github.com/affaan-m/ECC.git`), impeccable 4.4.0(`pbakaus/impeccable`), claude-mem 13.28.0(`thedotmack/claude-mem`), prompts.chat 1.0.0(`f/prompts.chat`). 어디까지 필수로 둘지는 9장 K2에서 정한다.

### 6단계 백업(`C:\projects\erp-project-wyops6-backup`) — 다시 쓸 범위

| 백업 내용 | 지금과 비교 | 다시 쓰는가 |
|---|---|---|
| `wy-ops/vscode/*`(그때의 확장 파일 16개) | 그 뒤 B2·B3에서 활동 탭, 훅 4종, 권한·할 일 카드, 출처 대조, 테스트 다수가 더해져 낡았다 | **파일은 쓰지 않는다.** 폴더 이동은 지금 HEAD에서 `git mv`로 새로 한다(R1) |
| `package.json`의 이름·id 변경(`wy-ops`, `wyOps.*`) | 지금은 명령이 더 많다(`revealSession`, `wyActivity.open`, `offMessageAck`, 패널 2종) | **변경표만 참고한다**(R4). id 목록은 지금 코드에서 다시 뽑는다 |
| `gen-agents.js`·`gen-skill.js`의 require 경로 한 줄 | 같다 | 그대로 다시 적용한다(R1) |
| `wy-ops/ps/session.ps1` | 지금 `.claude/skills/pm-ops/scripts/session.ps1`과 글자 단위로 같다(복사본) | 쓸 것 없음 |
| `exp-*.json(l)`(PermissionRequest 등 실험 기록) | — | 실험 증거로 남긴다(지우지 않음) |
| `step6-tracked.diff`·`status-before.txt` | — | 참고용 |

결론: 백업에서 되살릴 파일은 없다. 참고할 것은 10줄 남짓의 변경(경로·id)뿐이다.

## 2. 목표 모양

### 2.1 저장소 안 패키지(`tools/wy-ops/`, 나중에 그대로 떼어 낸다)

```
tools/wy-ops/
  package.json            패키지 버전 하나(설치본·doctor가 비교)
  install.ps1             사용자가 실행하는 진입점: setup · global · doctor · init · update · rollback · uninstall · cleanup-legacy · deploy
  NEW-PC.md               새 PC 체크리스트(로그인, 역할별 외부 준비, 전용 Chrome 프로필, 비밀값 위치 등, U-14). setup·global이 끝에 출력한다
  lib/                    install.ps1이 부르는 node 스크립트(JSON 병합·차이 표시·lock 해시·플러그인 점검)
  vscode/                 확장(지금 tools/vscode-dashboard를 옮김). hooks/는 그 안에 그대로
  stub/                   껍데기 확장 원본(K1-A): stub.js + 빌드 때 contributes를 복사해 vsix로
  gen-agents.js, gen-skill.js
  templates/
    agent.md              (있음) 역할 파일 공통 블록
    pm-ops/SKILL.md       (있음) 코어 스킬, pm-ops/scripts/session.ps1(옮겨 옴)
    wy-ops.json           새 프로젝트 기본 설정(역할 예시 포함)
    roles/*.md            역할 예시(commit, pm, planner, backend, frontend, qa)
    settings.hooks.json   훅 5종·deny 조각({{home}} 자리표시자). allow는 넣지 않는다(아래 3장)
    pm-ops.project.md     pm-ops 프로젝트 부록 초안(.claude/ops/pm-ops.project.md에 해당. 프로젝트 이름·docs 경로·역할을 wy-ops.json에서 채움)
    claude-md.md          CLAUDE.md에 넣을 절(init이 출력만 함)
    gitignore.txt         init이 넣는 줄(.claude/settings.local.json, .claude/wy-ops.local.json, .claude/*.bak-*)
```

패키지 안의 스크립트는 자기 폴더(`tools/wy-ops/`) 밖의 저장소 파일을 가정하지 않는다. 그래야 별도 저장소로 뗄 때 폴더를 옮기기만 하면 된다.

### 2.2 PC에 설치되는 것

- `~/.wy-tools/wy-ops/<버전>-<커밋>/`: 커밋본(HEAD)에서 꺼낸 패키지. 지금의 deploy.js 방식을 그대로 쓴다.
- `~/.wy-tools/wy-ops/current`: 위 폴더를 가리키는 **정션**(관리자 권한 불필요). 훅과 껍데기 확장은 `current` 경로를 쓴다. 최근 3개 버전을 남기고, `rollback`은 정션만 되돌린다.
- VS Code 확장: 껍데기 확장 `wy-ops.wy-ops`(K1-A). 실제 코드는 `current/vscode`에서 불러오므로 업데이트는 설치 → Reload로 끝난다. 껍데기를 다시 설치하는 것은 contributes(뷰·명령 목록)가 바뀔 때뿐이고, 설치 명령이 해시를 비교해 알아서 한다.
- `.claude/settings.local.json`: 훅 5종(승인 가드, 메시지 가드, 권한 확인, 권한 거부, 세션 시작)과 deny 줄. 그 PC의 홈 경로로 계산해 넣고, 다른 키는 보존한다.
- 승인 폴더 `~/.claude/wy-approvals/<namespace>/`: 빈 폴더로 만든다. 옮기지 않는다.

### 2.3 사용자가 실행하는 명령

OPS-10-1(다른 PC, 같은 프로젝트). 명령 2개와 Reload 1회다:
1. `git clone <저장소> C:\projects\erp-project`
2. 저장소 루트에서 `powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 setup`
   - 하는 일: 전제 도구 확인(git·node·code·claude) → 패키지 설치와 `current` 정션 → 껍데기 확장 설치 → 필수 플러그인 설치 → settings.local.json 병합(차이를 보여 주고 y로 확인) → 승인 폴더 → doctor → 남은 손일 체크리스트 출력
3. VS Code `Developer: Reload Window`
- 그 뒤 남은 손일(외부 로그인 등)은 승인 센터 ③ 할 일 카드로 이어 간다.

OPS-10-2(새 프로젝트): 그 PC에 패키지가 없으면 먼저 이 저장소 clone에서 `install.ps1 global`을 한 번 실행한다. global은 설치본·껍데기 확장·필수 플러그인만 설치하고, 이 저장소의 settings는 건드리지 않는다. 분리 전에는 이 저장소 `tools/`에서 설치한다(D-91). 그 뒤 새 프로젝트 폴더에서 `powershell -ExecutionPolicy Bypass -File ~\.wy-tools\wy-ops\current\install.ps1 init`을 실행하고 Reload한다. 이미 erp-project에 setup을 한 PC라면 global을 따로 할 필요가 없다.

점검: 어느 때든 `install.ps1 doctor`. 실패마다 고치는 명령 한 줄을 보여 준다.

## 3. 명령별 동작

| 명령 | 하는 일 | 쓰는 곳 | 쓰지 않는 곳 |
|---|---|---|---|
| `deploy` | HEAD의 `tools/wy-ops/`를 새 버전 폴더로 꺼내고 `current`를 바꾼다(지금 deploy.js의 일). 껍데기 확장의 contributes가 바뀌었으면 다시 설치하라고 알린다 | `~/.wy-tools/wy-ops/` | settings, 승인 결정 |
| `setup` | 위 2.3의 2번(= `global` + 이 프로젝트 settings 병합·승인 폴더·남은 일 할 일 카드) | 설치 폴더, VS Code 확장, 사용자 범위 플러그인, `.claude/settings.local.json`(확인 뒤), 승인 폴더(빈 폴더), `requests/`(할 일 카드) | `decisions/`·`used/`(OPS-10-3), CLAUDE.md, 전역 설정 |
| `global` | 설치본·`current` 정션·껍데기 확장·필수 플러그인, NEW-PC.md 체크리스트 출력. 어느 프로젝트의 settings도 건드리지 않는다 | 설치 폴더, VS Code 확장, 플러그인 | 프로젝트 파일 |
| `cleanup-legacy` | 이 PC 정리(U-13): 옛 승인 위치(`~/.claude/wy-approvals/` 바로 아래의 requests·decisions·used)와 옛 설치본 `~/.wy-tools/vscode-dashboard`의 목록을 보여 주고, 확인(y)을 받은 뒤에만 지운다. 자동으로 지우지 않는다 | 옛 위치 | 프로젝트별 승인 폴더 |
| `doctor` | 아래 4장 점검. 읽기만 한다 | — | 전부 |
| `init` | 새 프로젝트: `wy-ops.json`(질문 또는 `-Name -Prefix -Roles`) → `.claude/ops/`(역할 원본 복사, pm-ops 부록 초안 `pm-ops.project.md`를 템플릿에서 생성) → `gen-agents`·`gen-skill` → settings 병합(확인) → `.gitignore`에 3줄(`.claude/settings.local.json`, `.claude/wy-ops.local.json`, `.claude/*.bak-*`) → 승인 폴더 → `.claude/wy-ops.lock.json` → CLAUDE.md에 넣을 절 **출력**(자동 수정 안 함) → doctor | 새 프로젝트 `.claude/`, `.gitignore` | 이미 있는 파일 덮어쓰기(있으면 차이만 보여 주고 건너뜀) |
| `update` | `deploy`를 하고 각 생성 파일을 다시 만든다. lock 해시와 다르면(사람이 고침) 덮지 않고 차이만 보여 준다 | 생성 파일 | 사람이 고친 파일 |
| `rollback [버전]` | `current` 정션을 이전 버전으로 되돌린다(Reload) | 정션 | — |
| `uninstall` | 이 프로젝트의 훅·deny 조각과 lock에 있는 생성 파일을 지운다(확인 뒤) | settings 조각 | 승인 폴더·대화 기록 |

구현 메모:
- JSON 병합·차이 표시·해시는 node(`lib/*.js`)가 맡는다. PowerShell 5.1의 ConvertTo-Json 깊이·배열 문제를 피하려는 것이고, node는 전제 도구다.
- 정션·`code` 호출·vsix zip은 PowerShell이 맡는다. 한글이 든 .ps1은 UTF-8 BOM으로 저장한다(이번 B2 settings 스크립트에서 BOM이 없어 깨진 일이 있었다).
- settings 병합 규칙은 이번 B2 스크립트(`wy-b2-settings.ps1`)와 같다. 이미 있는 항목은 건너뛰고(여러 번 실행해도 결과가 같음), 쓰기 전에 `.bak-<시각>`을 남기며, 다른 키는 그대로 둔다. 바뀌는 점은 둘이다. 훅 경로를 `current` 경로로 **교체**하고(옛 `~/.wy-tools/vscode-dashboard` 경로를 찾아 바꿈), 쓰기 전에 차이를 보여 준다.
- settings 템플릿에는 훅 5종과 deny만 넣는다. 이 PC의 allow 1줄(`WebSearch`)은 프로젝트와 무관한 개인 설정이라 병합하지 않고, 이미 있는 allow는 그대로 둔다(요구사항 6장의 "확인 필요" 해소, pm 결정).
- 남은 일 할 일 카드(OPS-10-1 첫 기준, OPS-01): setup은 끝에 doctor가 '자동으로 확인 못 함·미충족'으로 보고한 체크리스트 항목(로그인, 비밀값 폴더, 역할별 외부 준비 등 NEW-PC.md 항목)을 승인 폴더 `requests/setup-<항목>.json`에 할 일 카드로 쓴다(`lib/todo.js`의 작성 함수). 카드는 B2-2 형식(what·why·onClick·steps·check)이고, 같은 id가 이미 있으면 다시 쓰지 않는다. 결정 파일은 쓰지 않는다(OPS-10-3). 승인 센터가 뜨기 전에는 같은 목록을 터미널에 출력한다.
- 세션은 이 명령으로 settings를 고치지 않는다(D-87). 세션이 설정 변경이 필요하다고 판단하면 할 일 카드에 "`install.ps1 setup` 실행"을 올린다. 승인 가드도 `.claude/settings.local.json`에 쓰는 셸 명령을 막고 있다.

## 4. doctor 점검 항목

| 항목 | 통과 조건 | 실패 때 보여 줄 한 줄 |
|---|---|---|
| 전제 도구 | git, node(18+), code(PATH), claude, PowerShell 5.1 | 설치 링크 |
| 설치본 | `current`가 있고, 설치본 버전·커밋이 저장소 `tools/wy-ops/package.json`·HEAD와 같다 | `install.ps1 deploy` |
| 훅 5종 | settings.local.json의 각 훅 경로에 파일이 있고 `current` 아래를 가리킨다(경로가 없으면 훅이 조용히 통과하므로 가장 중요) | `install.ps1 setup` |
| deny 줄 | 승인 결정·사용 표시·세션 기록·메시지 기록·설치본·설정 3종 | `install.ps1 setup` |
| 확장 | `code --list-extensions`에 껍데기 확장이 있고, 껍데기 contributes 해시가 설치본과 같다. 옛 `erp-project.erp-session-dashboard`가 없다 | `install.ps1 setup` |
| 플러그인 | 필수 플러그인이 설치·활성이고 버전이 wy-ops.json과 같다(다르면 경고만) | 설치 명령 그대로 |
| 승인 폴더 | `~/.claude/wy-approvals/<namespace>/`가 있고 쓸 수 있다 | 자동 생성 |
| 설정 | wy-ops.json 스키마, roles와 `.claude/agents/*.md`가 맞는다(`gen-agents --check`) | `node tools/wy-ops/gen-agents.js` |
| 개인 경로 | 커밋되는 파일(wy-ops.json, `.claude/ops/`, agents, skills)에 사용자 홈 절대 경로가 없다 | 해당 파일·줄 |
| .gitignore | `.claude/settings.local.json`, `.claude/wy-ops.local.json`, `.claude/*.bak-*`가 저장소 `.gitignore`에 있다(U-12. setup이 `.bak-<시각>`을 만들기 때문) | 넣을 줄 |
| 출처 대조 원장 | 확장 id 변경(R4) 뒤 처음 doctor를 실행하면 "원장을 새로 시작함(이 시각 전의 결정은 신뢰)"을 알린다 | — |
| 비밀값 폴더 | 있는지만 본다(내용은 읽지 않음). 없어도 경고만 | 체크리스트 |
| 경로 주의 | 홈·저장소 경로에 공백·한글이 있으면 경고하고, 훅을 견본 입력으로 한 번씩 실행해 확인한다. `code` 실행 파일 위치(User/System 설치)를 보고한다 | 해당 훅·경로 |

## 5. 단계

원칙: 단계마다 커밋 1개 → 배포 → Reload → 검증. 단계마다 앞 단계로 되돌릴 수 있다. 훅 경로를 바꾸는 단계(R4)는 새 경로에 파일이 있는 것을 doctor로 확인한 뒤에 바꾼다. 승인 대기열이 비어 있을 때 진행한다. 테스트는 바뀐 모듈만 돌리고, 전체는 WY-commit 사본 검증에 맡긴다.

| 단계 | 내용 | 바뀌는 파일 | 완료 조건·검증 | 사용자 손 |
|---|---|---|---|---|
| R1 패키지 폴더 | `git mv tools/vscode-dashboard tools/wy-ops/vscode`. gen-*의 require 경로, deploy.js의 원본 경로, README·테스트 경로를 고친다. 설치 위치는 아직 `~/.wy-tools/vscode-dashboard` 그대로라 운영에는 변화가 없다 | 위 폴더 전체(이동), `tools/wy-ops/gen-*.js`. 문서 속 경로(CLAUDE.md, `.claude/ops/roles/*.md`, pm-ops 부록)는 WY-pm 몫 | 확장 테스트 전부, gen-agents 테스트 통과. 배포 뒤 설치본이 같은 내용(파일 목록·해시 비교). 승인 카드 1회 왕복 | 없음(Reload 1회) |
| R2 버전 설치·껍데기 확장 | deploy가 `~/.wy-tools/wy-ops/<버전>-<커밋>/`과 `current` 정션을 만든다(최근 3개 유지). 껍데기 확장 원본과 vsix 빌더를 만든다. 옛 경로 `~/.wy-tools/vscode-dashboard`에도 계속 배포해 지금 훅·확장을 살려 둔다 | `tools/wy-ops/stub/*`, `install.ps1`(deploy만), `lib/deploy.js`, `package.json` | 임시 `WY_TOOLS_DIR`에서 버전 폴더 3개 회전·rollback 정션 확인. 껍데기 vsix를 `code --extensions-dir <임시>`에 설치해 목록에 뜨고, 가짜 vscode로 껍데기가 `current/vscode`를 불러와 뷰를 등록하는지 확인 | 없음 |
| R3 설치 명령 | `setup`·`global`·`doctor`·`init`·`update`·`rollback`·`uninstall`·`cleanup-legacy`, settings 병합(차이·확인·bak, allow는 건드리지 않음), lock 해시, 플러그인 점검·설치, 남은 일 할 일 카드 작성(`lib/todo.js`), NEW-PC.md, 템플릿(wy-ops.json·roles·settings.hooks·pm-ops.project·claude-md·gitignore), session.ps1을 코어 템플릿으로 옮기고 gen-skill이 복사하게 함. **이 저장소 `.gitignore`에 `.claude/settings.local.json`과 `.claude/*.bak-*`를 추가한다(U-12, pm 결정)** | `tools/wy-ops/install.ps1`, `lib/*.js`, `templates/*`, `NEW-PC.md`, `gen-skill.js`, pm-ops 템플릿(내용은 WY-pm 검토), `.gitignore`(WY-pm 확인) | 임시 홈(`USERPROFILE`·`WY_TOOLS_DIR`·`WY_APPROVALS_DIR` 바꿈)과 임시 확장 폴더에서 setup → doctor 통과. 같은 setup을 두 번 하면 두 번째는 "바꾼 것 없음". 이미 있는 settings의 다른 키·allow 보존. 결정 파일을 쓰지 않음(쓰기 감시). 할 일 카드: 미충족 항목마다 `requests/setup-*.json`이 B2-2 형식으로 생기고 readRequest가 broken으로 보지 않음, 다시 실행하면 새로 쓰지 않음. BOM 한글 왕복 | 없음 |
| R4 이 PC 전환 | 확장 id를 `wy-ops`로 바꾼다(D5, 뷰·명령·webview id 전부, 백업 변경표 참고). 이 PC에서 setup을 실행한다: 훅이 `current` 경로로 바뀌고, 옛 확장을 제거하고 껍데기를 설치한다. **조건: 승인 대기 카드가 0일 때만 한다(setup이 대기 수를 보고 0이 아니면 멈춤). 전환 직후 doctor가 "출처 대조 원장을 새로 시작함"을 알린다(pm 결정)** | `tools/wy-ops/vscode/package.json`·`*.js`(id), 테스트 | 설치 직후 doctor 통과(원장 새로 시작 알림 포함). 시험 세션으로 네 종류 카드(OPS-02) 왕복, `--agent` 역할 세션이 세션 현황·활동 보기에 보임. 남은 일 할 일 카드가 승인 센터에 보이고 '했음'으로 닫힘. 필수 플러그인 단계는 이미 설치된 경우(건너뜀) 경로를 확인. 하루 뒤 `install.ps1 cleanup-legacy`로 옛 설치본·옛 승인 위치 정리(목록 확인 뒤) | **setup 실행 1회(차이 확인 y), Reload 1회, 카드 4장 + 할 일 카드 처리, cleanup-legacy 확인 1회**. 승인 센터의 VS Code 저장 상태(출처 대조 원장·확인함·접힘)가 id 변경으로 초기화된다(K4) |
| R5 OPS-10-1 리허설 | 다른 경로에 두 번째 clone(`C:\projects\wy-pc2`)을 만들고, 임시 홈(`USERPROFILE`)과 임시 Claude 설정 폴더(`CLAUDE_CONFIG_DIR`)를 지정해 setup을 **플러그인까지** 돌린다 | 없음(시험) | 명령 2개 + Reload 수준으로 끝남. doctor 통과. 필수 플러그인 2개가 임시 설정 폴더에 실제로 설치되고 doctor가 버전을 확인함(설치 경로 검증). 생성된 settings에 이 PC 홈 경로가 없고 임시 홈 경로만 있음. 커밋 파일에 개인 경로 없음. 훅 5종을 임시 홈 경로에서 견본 입력으로 직접 실행: 가드 거부, 메시지 가드, 세션 시작이 임시 승인 폴더에 등록 기록을 씀, 권한 훅이 모르는 세션에 바로 null. 남은 일 할 일 카드 파일이 임시 승인 폴더에 생김 | 없음. **실제 다른 PC 확인을 권장**(아래) |
| R6 OPS-10-2 새 프로젝트 | `C:\projects\ops-sandbox`(git init)에서 init → doctor → 역할 세션 하나 → 결정 카드 1회 + git 승인 카드 1회 | 시험 프로젝트만 | 10-2 수용 기준 전부: 파일 생성, 기존 CLAUDE.md·settings 키를 덮지 않음(미리 넣어 둔 값으로 확인), 두 프로젝트의 대기열·세션 현황·활동 보기가 섞이지 않음 | **카드 2장 처리**, init 중 차이 확인 y |
| R7 OPS-10-3 업데이트·되돌리기 | update가 lock 해시로 사람이 고친 생성 파일을 지키는지, rollback으로 이전 버전이 도는지 확인한다. README(설치·업데이트·옮기지 않는 것·PC 옮기기 전 할 일)를 정리한다 | `tools/wy-ops/README.md`, `lib/lock.js` | 생성 파일 하나를 손으로 고친 뒤 update → 덮지 않고 차이만 보임. rollback → doctor가 이전 버전을 보고하고 카드 1회 왕복 | Reload 1회 |
| (P4 이후) 저장소 분리 | `tools/wy-ops/`를 별도 저장소로 옮긴다(`git subtree split`으로 이력 보존). setup의 설치 원본만 바뀐다 | — | 이 계획 범위 밖 | — |

R5에서 카드 왕복과 역할 세션을 하지 않는 이유와 남는 위험(WY-planner 대조 2):
- 임시 홈에서는 Claude Code 로그인 정보가 없어 세션을 띄울 수 없다. 그래서 카드 4종 왕복과 `--agent` 역할 세션은 R4(실제 홈, 같은 setup 경로)에서 확인하고, R5는 그 PC에서만 달라지는 부분을 확인한다. 달라지는 부분은 홈 경로로 계산한 훅 경로, 훅 실행, 승인 폴더·등록 기록 위치, 플러그인 설치다.
- 남는 위험: 홈 경로에 공백·한글이 있는 PC, 다른 VS Code 설치 형태(User/System 설치, `code`가 PATH에 없음), 실제 로그인한 다른 계정에서의 세션 등록. 이것은 R5로 다 볼 수 없다. **분리(P4 이후) 전에 사용자가 실제 다른 PC에서 setup → 카드 1회 왕복을 한 번 하는 것을 권장한다**(사용자 손, 할 일 카드로 올림). doctor가 공백·한글 경로와 `code` 위치를 점검 항목에 넣어 미리 알린다.

작업량(대략): R1 0.5일, R2 1일, R3 2일, R4 0.5일, R5 0.5일, R6 0.5~1일, R7 0.5일. 합계 5.5~6일(세션 교대 2~3회). 사용자 손은 R4(명령 1회·Reload·카드 4장·할 일 카드·cleanup 확인), R6(카드 2장), R7(Reload), 그리고 권장하는 실제 다른 PC 확인 1회다. 모두 할 일·결정 카드로 올린다.

병렬: R1은 `tools/vscode-dashboard`를 고치는 세션(WY-backend1·3)이 미커밋 파일이 없는 시점에 한 번에 해야 한다(이동 뒤에는 새 경로로 작업). R2·R3은 WY-backend2 한 갈래로 하고, R3의 템플릿 문구(역할 예시·claude-md·pm-ops 코어)는 WY-pm 검토를 받는다(D8).

## 6. 체크리스트로만 안내하는 것(setup 끝에 출력, 승인 센터가 뜬 뒤에는 할 일 카드)

- 로그인: Claude Code(전제), GitHub(`gh auth status`로 확인), 외부 콘솔(Railway·Vercel, WY-browser 몫)
- 사용자 전역 설정(U-09 결정): `~/.claude/CLAUDE.md`, 사용자 스킬(`~/.claude/skills/`), VS Code 사용자 설정. 필요하면 사용자가 직접 옮긴다
- 메모리 폴더(U-07 결정): 옮기지 않는다. 경로가 다른 PC에서는 폴더 이름도 달라서 새로 쌓인다
- 비밀값 폴더(`C:\projects\worklog-secret\`): 사용자가 안전한 방법으로 직접 옮긴다
- 역할별 외부 준비(U-14, pm 결정): agent-browser(npm 전역), WY-browser 전용 Chrome 프로필·CDP 9222, 외부 로그인, 비밀값 위치. 목록은 패키지 안 `tools/wy-ops/NEW-PC.md` 한 파일에 둔다
- 선택 플러그인(K2): claude-mem, prompts.chat
- 옮기지 않는 것과 옮기기 전 할 일: 진행 중 카드 처리, 작업 경계에서 역할 세션 멈추기, 인수인계·대화 기록·승인 대기열은 이 PC에만 남음
- 이 PC의 옛 승인 폴더(`~/.claude/wy-approvals/` 바로 아래, 3단계 전 파일) 정리(U-13, pm 결정): `cleanup-legacy`가 목록을 보여 주고 확인 뒤 지운다

## 7. 위험과 대응

- **훅이 조용히 통과**: 경로가 틀리거나 node가 없으면 Claude Code가 훅을 건너뛴다 → setup이 settings를 쓰기 전에 새 경로의 파일을 확인한다. doctor가 첫 점검 항목으로 본다.
- **확장 id 변경으로 저장 상태 초기화(R4)**: 출처 대조 원장이 비면, 원장 시작 전의 결정은 신뢰하도록 되어 있다(B2-1). 그래서 경고가 쏟아지지는 않는다. 다만 전환 직전에 위조된 결정이 있었다면 그것도 신뢰된다 → 전환은 승인 대기 카드가 0일 때만 하고(setup이 확인하고 멈춤), 전환 직후 doctor가 원장을 새로 시작했다고 알린다(pm 결정).
- **껍데기 확장이 설치본을 못 찾음**: `current`가 없거나 깨지면 껍데기가 "install.ps1 setup 실행" 안내를 띄우고 멈춘다(확장 오류로 VS Code가 흔들리지 않게).
- **정션 삭제**: 정션을 지울 때 대상 폴더가 지워지지 않도록 `rmdir`(정션만)을 쓴다. 테스트에 넣는다.
- **플러그인 버전**: 외부 마켓플레이스라 ref 고정은 마켓플레이스 단위다. 마켓플레이스가 태그를 안 쓰면 커밋으로 고정하고, doctor는 버전이 달라도 경고만 한다(일을 막지 않음).
- **R1 이동 중 다른 세션의 미커밋 변경**: 이동 커밋은 tools/ 아래 미커밋 파일이 없을 때만 한다(WY-pm이 시점을 잡는다).
- **여러 VS Code 창**: 창마다 자기 워크스페이스의 설정·대기열을 본다(지금과 같음). wy-ops.json이 없는 워크스페이스에서는 승인 센터를 끈다.

## 8. 바뀌지 않는 것

- 승인 규약(요청·결정·used 파일), 가드 훅 판단, 카드 형식(B2-2) — 경로만 바뀌고 내용은 그대로다.
- 커밋·배포 흐름: 커밋은 WY-commit, 배포는 WY-backend2다(`node deploy.js` 대신 `install.ps1 deploy`).
- 역할 원본(`.claude/ops/`)과 생성 규칙(gen-agents·gen-skill).

## 9. 결정 (2026-10-07 확정, 모두 A)

사용자가 승인 센터 카드 1140에서 K1~K4를 모두 추천안(A)으로 정했다. 결정 기록은 WY-planner가 D-92로 남긴다. 아래는 결정 당시의 선택지와 대가다(기록용).

| ID | 항목 | 선택지와 대가 | 결정 |
|---|---|---|---|
| K1 | 확장 설치 방식 | **A. 껍데기 확장(vsix) + 설치본 불러오기**: 새 PC도 명령으로 설치한다. 업데이트는 deploy → Reload만 하면 되고, 코드 사본이 하나라 버전이 어긋나지 않는다. 대가: 껍데기 코드(약 40줄, 확장 컨텍스트의 경로를 설치본으로 바꿔 넘김)를 관리해야 하고, contributes가 바뀌면 다시 설치해야 한다(설치 명령이 알아서 함). **B. 전체 vsix를 업데이트마다 다시 설치**: 단순하다. 대가: 확장 사본(`~/.vscode/extensions`)과 훅 사본(`~/.wy-tools`)이 따로라 버전이 어긋날 수 있고, 배포 때마다 `code --install-extension --force`를 해야 한다. **C. 지금처럼 Install from Location**: 명령으로 할 수 없어, 새 PC마다 UI 손일이 1회 남는다 | A |
| K2 | 필수 플러그인 | **A. ecc·impeccable만 필수로 설치·버전 점검**하고, claude-mem·prompts.chat은 체크리스트(선택). 대가: 다른 PC에서 그 두 플러그인 기능이 기본으로는 없다. **B. 4개 모두 필수**: 이 PC와 똑같아진다. 대가: 운영 도구가 쓰지 않는 플러그인까지 고정·점검해야 한다 | A |
| K3 | R1 폴더 이동 시점 | **A. 이번 계획의 첫 단계로, tools/ 미커밋 파일이 없는 시점에 한 번에**. 대가: 그 시점에 WY-backend1·3의 tools 작업을 잠깐 멈추고, 문서·역할 파일 속 경로를 WY-pm이 함께 고쳐야 한다. **B. 이동하지 않고 tools/vscode-dashboard를 패키지 안에 그대로 둔다**(패키지 루트가 tools/ 둘로 갈림). 대가: 분리할 때 폴더 두 개를 합쳐야 하고, 설치 스크립트가 경로 두 곳을 알아야 한다 | A |
| K4 | 확장 id 변경(D5) 시점 | **A. R4 이 PC 전환 때 함께**(껍데기 설치와 한 번에). 대가: 승인 센터의 VS Code 저장 상태(출처 대조 원장·확인함·접힘)가 한 번 초기화된다. **B. 바꾸지 않는다**(`erp-project.erp-session-dashboard` 유지). 대가: 다른 프로젝트에서도 'ERP' 이름이 보이고, 나중에 바꾸면 그때 같은 초기화가 생긴다 | A |

pm 결정(구현 세부, 2026-10-07): U-12 `.gitignore`에 `.claude/settings.local.json`·`.claude/*.bak-*`(R3, init·doctor 포함), U-13 cleanup-legacy(목록 확인 뒤 삭제), U-14 `NEW-PC.md`(setup·global이 출력), allow 1줄은 병합하지 않음, R4는 대기 카드 0일 때만 하고 원장 새로 시작을 알림, 가드의 대상 안 보이는 이동(cd -·popd)은 알 수 없음(4760134로 반영).

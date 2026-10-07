# WY Ops 사용 설명서

여러 Claude Code 세션이 역할을 나눠 일할 때, 사람이 할 일(승인·결정·직접 할 일)을 한곳에서 처리하고 세션 상태를 보는 도구입니다. 이 문서만 보고 다른 PC나 새 프로젝트에서 따라 할 수 있게 썼습니다.

함께 보는 문서:
- [NEW-PC.md](NEW-PC.md): 새 PC에서 사람이 직접 할 일 체크리스트(로그인, 옮길 것, 역할별 준비)
- [vscode/README.md](vscode/README.md): 카드 요청 파일 형식(세션이 카드를 올릴 때 쓰는 규칙)
- 저장소 `CLAUDE.md`: 세션 역할과 작업 규칙의 원본
- `tools/PACKAGING-PLAN.md`(이 저장소에만 있음): 설치 구조를 정한 배경

명령은 PowerShell 기준입니다. Bash(Git Bash)에서만 되는 명령은 **[Bash]**로 표시했습니다.

---

## 1. 한눈에 보기

| 이름 | 하는 일 | 어디에 |
|---|---|---|
| 승인 센터 | 세션이 올린 카드를 처리한다(권한·결정·할 일·git) | 상태 표시줄 '승인 대기 N'을 누르면 열리는 작업창 탭. 명령 팔레트 `WY: 승인 센터 열기` |
| 세션 현황 | 역할 세션이 지금 무엇을 하는지, 멈춘 세션 열기 | 왼쪽 활동 막대의 **WY Ops** 아이콘 → 사이드바 |
| 활동 탭 | 세션끼리 주고받은 메시지를 작업 묶음으로 본다 | 명령 팔레트 `WY: 활동 보기`, 승인 센터에서 `g` `a` |
| 역할 세션 | 역할 파일(`.claude/agents/<역할>.md`)을 싣고 백그라운드에서 도는 Claude 세션 | 터미널 `claude agents`, 세션 현황 |
| 훅 | 세션이 위험한 일을 하지 못하게 막고, 권한 확인을 카드로 바꾼다 | 프로젝트 `.claude/settings.local.json`(설치 명령이 넣음) |

훅 다섯 가지:

| 훅 | 하는 일 |
|---|---|
| 승인 가드 | 커밋·푸시 같은 git 명령은 커밋 역할 세션이 승인 카드를 받은 뒤에만 실행. 승인 파일·설정 파일을 셸로 고치지 못하게 막음 |
| 메시지 가드 | 꺼진 세션에 메시지를 보내려 하면 막고 다시 띄우는 법을 알려 줌 |
| 권한 확인 | 백그라운드 세션이 확인 창을 기다리면 승인 센터에 권한 카드를 올림 |
| 권한 거부 | 자동 판단(분류기)이 막은 명령을 할 일 카드로 올림 |
| 세션 시작 | 세션이 어떤 역할로 떴는지 기록(역할 누락 경고에 씀) |

여러 VS Code 창을 열면 창마다 그 폴더(프로젝트)의 카드와 세션만 보입니다. 다른 프로젝트 카드는 그 프로젝트 창에서 봅니다.

---

## 2. 설치

### 2-1. 다른 PC에서 같은 프로젝트 이어 가기

준비: [NEW-PC.md](NEW-PC.md) 1장의 도구(Git, Node 18+, VS Code와 `code` 명령, Claude Code 로그인)

1. 저장소를 받습니다.
   ```powershell
   git clone <저장소 주소> C:\projects\erp-project
   cd C:\projects\erp-project
   ```
2. 이 폴더를 Claude Code가 신뢰하게 합니다(한 번만).
   ```powershell
   claude
   ```
   'Do you trust the files in this folder?'에 **Yes** → 준비 화면이 나오면 `/exit`. VS Code의 '작성자 신뢰'와는 따로입니다. 이것이 없으면 역할 세션이 뜨지 않습니다.
3. 설치 명령을 실행합니다.
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 setup
   ```
   - 설치본·확장·필수 플러그인을 깔고, `settings.local.json`에 넣을 내용을 보여 줍니다. 맞으면 `y`.
   - 끝에 점검 표가 나옵니다. **FAIL**이 있으면 그 줄의 '고치기' 명령을 실행합니다.
   - 남은 손일(로그인 등)은 승인 센터에 할 일 카드로 올라옵니다.
4. VS Code에서 `Developer: Reload Window`(명령 팔레트 Ctrl+Shift+P).
5. 왼쪽에 **WY Ops** 아이콘이 보이면 끝입니다. [NEW-PC.md](NEW-PC.md)의 나머지(로그인, 비밀값 폴더, 역할별 준비)를 챙깁니다.

옮기지 않는 것: 승인 대기열, 대화 기록, 인수인계 파일, 메모리. PC를 바꾸기 전에 대기 카드를 모두 처리하고, 역할 세션을 작업 경계에서 멈춥니다.

### 2-2. 새 프로젝트에 붙이기

1. 이 PC에 아직 설치한 적이 없으면, 이 저장소에서 한 번만:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 global
   ```
   (이미 `setup`을 한 PC면 건너뜁니다.)
2. 새 프로젝트 폴더에서(먼저 `git init`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.wy-tools\wy-ops\current\install.ps1" init --name <프로젝트 이름> --prefix <역할 접두사, 예: AB->
   ```
   - 역할을 고르려면 `--roles commit,backend,qa`(커밋·pm 역할은 늘 포함).
   - 만드는 것: `.claude/wy-ops.json`, 역할 원본·역할 파일, pm-ops 스킬, `.gitignore` 줄, `settings.local.json`.
   - 이미 있는 파일은 덮지 않습니다.
3. 출력 끝의 **CLAUDE.md에 넣을 절**을 복사해 그 프로젝트 `CLAUDE.md`에 붙입니다(자동으로 고치지 않습니다).
4. 신뢰 안내가 나오면 그 폴더 터미널에서 `claude` → Yes → `/exit`.
5. 그 폴더를 VS Code로 열고 `Developer: Reload Window`.
6. 확인: `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.wy-tools\wy-ops\current\install.ps1" doctor --project .`

`-File` 뒤에는 `~`를 쓰지 않습니다. PowerShell이 `~`를 펼치지 않아 "does not exist"로 실패합니다. `$env:USERPROFILE`을 큰따옴표 안에 씁니다.

---

## 3. 매일 쓰기

### 3-1. 승인 센터

카드 네 가지:

| 카드 | 언제 뜨나 | 무엇을 누르나 |
|---|---|---|
| 권한 | 백그라운드 세션이 실행 확인을 기다릴 때 | **이번 한 번 허용** 또는 **거부**(사유 필수). 15분 안에 안 누르면 자동 거부 |
| 결정 | 세션(주로 pm)이 방향을 물을 때 | 질문마다 선택지를 고르고 **답 보내기**. '추천' 표시, 선택지마다 대가가 적혀 있음. '기타'에 직접 써도 됨 |
| 할 일 | 사람이 직접 해야 할 일(설정 수정, 외부 콘솔, 직접 실행) | 단계를 따라 한 뒤 **했음**. 메모에 결과를 적으면 세션이 그에 맞춰 이어 감 |
| git | 커밋·푸시·병합 등 | **승인** 또는 **거부**(사유 필수). 바뀐 파일·검증 결과를 보고 판단 |

카드마다 '무엇을'·'왜'·'누르면 무슨 일'이 있습니다. 이 세 칸이 빈 요청은 **형식 오류** 카드로 뜨고 처리 버튼이 없습니다.

할 일 카드 쓰는 법:
- 단계 목록을 눌러 체크하며 따라 합니다(진행 막대는 기억용).
- 메모 예: '실행함', '실행 안 함 — 필요 없어 보임', 오류 메시지 붙여넣기.
- 분류기가 막은 명령 카드는 대부분 실행하지 않아도 됩니다. 판단이 어려우면 메모에 '실행 안 함'을 적고 **했음**.
- 명령 블록이 두 개면 위가 PowerShell에 붙여 넣을 형태, 아래가 원래 명령(Bash)입니다(3-4 참고).

거부 사유: 세션에 그대로 전달됩니다. '무엇이 문제인지 + 어떻게 하면 되는지'를 한 줄로 씁니다. 예: '테스트 결과가 없음 — 테스트를 돌린 뒤 다시 요청'.

단축키(승인 센터 탭에 포커스가 있을 때):

| 키 | 하는 일 |
|---|---|
| `j` / `k` | 다음·이전 카드 |
| `a` | 처리(승인·허용·답 보내기·했음) |
| `x` | 거부 |
| `1`~`9` | 결정 카드의 선택지 고르기 |
| `Enter` / `Esc` | 열기 / 목록으로·취소 |
| `w` | '왜' 펼치기 |
| `g` `a` | 활동 탭 |
| `?` | 단축키 안내 펼치기·접기 |

### 3-2. 세션 현황(사이드바)

| 상태 | 뜻 | 할 일 |
|---|---|---|
| 권한 대기 | 확인 창을 기다림. 기다리는 명령이 함께 보임 | 승인 센터의 권한 카드를 처리 |
| 일하는 중 | 작업 중 | 없음 |
| 입력 대기 | 일을 마치고 다음 지시를 기다림 | pm이 지시하면 됨 |
| 꺼짐 | 멈춤·스스로 끝남·오류로 끝남(작은 글씨로 이유) | pm이 `session.ps1 start`로 다시 띄움 |
| 띄우지 않음 | 역할 표에는 있지만 아직 안 띄움 | 필요할 때 띄움 |

- 정렬: 권한 대기 → 일하는 중 → 입력 대기 → 꺼짐 → 띄우지 않음. 꺼짐·띄우지 않음은 아래 접힌 묶음.
- **열기**: 백그라운드 세션에 직접 들어갑니다(새 터미널에서 `claude attach`). 승인 센터로 안 되는 일(긴 대화, 직접 확인)이 있을 때만 씁니다. 들어갔다 나온 커밋 세션은 pm이 교대시킵니다.
- 주황 '꺼진 뒤 메시지 옴': 꺼진 세션에 누가 메시지를 보내려다 막혔습니다. pm에 알려 다시 띄우게 합니다. '확인함'을 누르면 표시가 사라집니다.
- '역할 누락' 경고: 그 세션이 역할 파일 없이 떴습니다. 커밋 세션이면 커밋이 막히므로 pm이 교대시킵니다.

### 3-3. 활동 탭

보기 세 가지(위쪽에서 고름):
- **묶음**(기본): 작업 하나(지시 → 보고 → 커밋 …)를 카드 한 장으로. 요약을 누르면 원문이 펼쳐집니다.
  - **진행 중**: 최근에 움직인 순서
  - **휴면 n**: 2시간 넘게 조용한 진행 중 묶음(접혀 있음)
  - **완료 n**: 끝난 묶음(접혀 있음)
- **피드**: 세션끼리 주고받은 메시지를 최신순으로
- **시간**(창이 넓을 때만): 세션별 가로줄에 일한 구간과 메시지 화살표. 1·3·12시간 중 고름. 화살표를 누르면 원문

세션 칩(맨 위 줄)을 누르면 세션 현황에서 그 세션을 보여 줍니다.

### 3-4. Bash와 PowerShell 명령 구분

- VS Code 터미널은 보통 PowerShell입니다. Bash 명령(`rm -rf`, `&&` 줄, `for … do … done`)을 붙여 넣으면 문법 오류가 납니다.
- 카드에 'Bash 명령'이라고 적혀 있으면 Git Bash 창에 붙여 넣거나, 카드의 'PowerShell에 붙여 넣을 형태'를 씁니다.
- PowerShell 명령은 Git Bash에서 실행되지 않습니다.

---

## 4. 명령 모음

설치 명령(저장소 루트에서 `tools\wy-ops\install.ps1`, 다른 프로젝트에서는 `"$env:USERPROFILE\.wy-tools\wy-ops\current\install.ps1"`):

| 명령 | 언제 | 예시 |
|---|---|---|
| `doctor` | 뭔가 이상할 때 먼저. 읽기만 함 | `powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 doctor` |
| `update` | 저장소를 pull한 뒤 운영 도구를 새 버전으로. 사람이 고친 생성 파일은 덮지 않고 차이만 보여 줌 | `… install.ps1 update` (미리 보기: `update --dry-run`) → Reload |
| `deploy` | 설치본만 HEAD로 갱신(보통 개발 세션이 함) | `… install.ps1 deploy` |
| `rollback` | 새 버전에 문제가 있을 때 이전 버전으로 | `… install.ps1 rollback` → Reload |
| `cleanup-legacy` | 옛 설치본·옛 승인 위치 정리. 목록을 보여 주고 `y`를 받은 뒤 지움 | `… install.ps1 cleanup-legacy` |
| `setup` / `global` / `init` | 설치(2장) | — |

세션 명령(pm이 주로 씀, 저장소 루트에서):

| 명령 | 언제 | 예시 |
|---|---|---|
| `list` | 역할 세션 목록과 상태 | `.claude\skills\pm-ops\scripts\session.ps1 list` |
| `health` | 대화 크기 확인(5MB 넘으면 교대 권장) | `… session.ps1 health` |
| `start` | 역할 세션 띄우기(멈춘 세션은 이어 띄움) | `… session.ps1 start WY-qa "P1 화면 검증"` |
| `stop` | 쉬는 세션 멈추기(메모리 반납, 대화는 남음) | `… session.ps1 stop WY-qa` |
| `rotate` | 대화가 길어진 세션을 새 세션으로 교대 | `… session.ps1 rotate WY-backend2 none` |

---

## 5. 문제가 생겼을 때

| 증상 | 원인 | 할 일 |
|---|---|---|
| 'Workspace not trusted'로 세션이 안 뜸 | 그 폴더를 Claude Code가 신뢰하지 않음 | 그 폴더 터미널에서 `claude` → Yes → `/exit`. VS Code 작성자 신뢰로는 안 됨 |
| 카드가 안 뜸 | 다른 프로젝트 창을 보고 있음 / 확장이 아직 안 실림 / 훅 경로가 틀림 | 그 프로젝트 창인지 확인 → `Developer: Reload Window` → `doctor`에서 '훅 5종'·'확장' 확인 |
| 권한 카드가 사라지고 세션이 '거부됨'을 받음 | 15분 안에 처리하지 않아 자동 거부 | 정상 동작. 필요하면 세션에 다시 하라고 지시(pm) |
| '형식 오류' 카드 | 요청 파일에 필수 칸(무엇을·왜·누르면)이 빠짐 | 처리할 수 없음. 요청한 세션(카드에 이름이 있음)에 다시 올리라고 pm에 알림 |
| WY Ops 아이콘·승인 센터가 안 뜸 | 확장이 설치본을 못 찾음 | `doctor` → '설치본'이 FAIL이면 `install.ps1 setup` → Reload. 그래도 안 되면 `install.ps1 rollback` → Reload |
| 설치 명령이 오류 없이 바로 끝남 | (옛 버전) 경로에 한글이 있을 때 Node가 죽던 문제 | `update`로 새 버전을 받으면 고쳐져 있음. 사용자 이름이 한글인 PC도 지원 |
| 공백·한글 경로 경고 | 홈·저장소 경로에 공백·한글 | 동작은 하지만 문제가 생기면 `doctor` 결과를 pm에 전달 |
| 붙여 넣은 명령이 'unexpected token' | Bash 명령을 PowerShell에 붙여 넣음 | 3-4 참고. Git Bash에서 실행하거나 PowerShell 형태를 씀 |
| 커밋이 'agent_type'으로 막힘 | 커밋 세션이 역할 없이 뜸(직접 들어갔다 나온 경우 등) | pm이 `session.ps1 rotate WY-commit none` |

확장을 예전 방식으로 되돌려야 할 때(마지막 수단):
1. 새 확장 제거: `code --uninstall-extension wy-ops.wy-ops`
2. 옛 확장 다시 설치: 명령 팔레트 `Developer: Install Extension from Location…` → `%USERPROFILE%\.wy-tools\vscode-dashboard` 폴더 선택
3. `settings.local.json`을 설치 전 백업(`.claude\settings.local.json.bak-<시각>`)으로 되돌림(훅이 옛 설치본을 다시 가리킴)
   ```powershell
   Copy-Item .claude\settings.local.json.bak-<시각> .claude\settings.local.json
   ```
4. `Developer: Reload Window`. 그 뒤 pm에 알려 원인을 찾게 합니다.

`cleanup-legacy`로 옛 설치본(`.wy-tools\vscode-dashboard`)을 지운 뒤에는 이 방법을 쓸 수 없습니다. 그때는 `install.ps1 rollback`(이전 버전으로) → Reload를 씁니다.

---

## 6. 지켜야 할 규칙(요약)

- **사람 손이 필요한 일은 카드로.** 세션은 대화창으로 묻지 않고 승인 센터 카드로 올립니다. 대화창으로 되묻는 일이 생기면 결함입니다.
- **설정 파일은 사람이 고친다.** `.claude/wy-ops.json`, `wy-ops.local.json`, `settings.local.json`은 세션이 고치지 못하게 막혀 있습니다. 바꿀 일이 있으면 할 일 카드로 오고, 사용자가 직접 고치거나 설치 명령을 실행합니다.
- **커밋·푸시는 커밋 역할 세션만.** 다른 세션은 커밋을 요청만 합니다. 커밋·푸시도 매번 승인 카드를 거칩니다(자동 승인 없음).
- **승인 파일은 아무도 손으로 고치지 않는다.** 승인 폴더(`~/.claude/wy-approvals/<프로젝트>/`)의 결정·사용 기록은 확장과 훅만 씁니다.

자세한 규칙은 저장소 `CLAUDE.md`의 '세션 역할'·'개발 총괄과 보고'·'커밋'·'세션 교대'를 봅니다.

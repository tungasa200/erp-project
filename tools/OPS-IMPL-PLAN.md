# 운영 도구 구현 계획 (OPS-01~09)

작성: WY-backend2, 2026-10-07. 상태: **확정**(2026-10-07 사용자 승인, 승인 센터 20261007-0230 — Q1~Q4 모두 추천안). 기준: `docs/운영도구_요구사항.md`(OPS-01~09), `docs/결정기록.md` D-82~D-89, 목업 `docs/운영도구/승인센터_목업.html`.

세 세션이 병렬로 진행한다: **WY-backend2** 승인 센터·훅·공용 연결, **WY-backend1** 세션 현황, **WY-backend3** 활동 피드. 파일은 겹치지 않게 나눴다(3장). 공용 연결 파일(`extension.js`, `package.json`, `deploy.js`)은 WY-backend2만 고친다.

## 1. 실험 결과 (2026-10-07, 미결 U-01·U-03·U-04·U-05)

실험 방법: 저장소 안 임시 폴더(신뢰된 작업 공간이어야 백그라운드 세션이 뜬다)에 PermissionRequest·Notification·Stop·PreToolUse 기록 훅과 ask 규칙(`Bash(echo two*)`, `Bash(echo three*)`)을 걸고, 백그라운드 세션에 명령 셋을 실행시켰다. 로그는 `C:\projects\erp-project-wyops6-backup\exp-*.json*`.

| 항목 | 결과 | 계획에 미치는 영향 |
|---|---|---|
| 백그라운드 세션의 권한 모드 | **auto**(분류기). 평범한 명령은 확인 창 없이 실행된다 | 권한 카드(①)가 뜨는 경우는 ask 규칙·보호 경로처럼 auto에서도 확인 창이 나는 경우뿐이다. 분류기가 막은 것은 PermissionDenied로 오며 ②·③ 카드로 보낸다(요구사항 그대로) |
| PermissionRequest 훅이 백그라운드에서 불리는지 | **불린다.** 훅이 allow를 돌려주면 attach 없이 이어서 실행됐다(파일 생성 확인) | OPS-02 ① 방식 그대로 구현 가능 |
| **훅 입력의 tool_use_id** | **없다.** 입력 키: session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input | D-82 (d)의 "결정 파일을 tool_use_id에 묶는다"를 **sha1(session_id · tool_name · tool_input JSON) 앞 16자**로 바꾼다. 같은 세션이 같은 명령을 다시 요청하면 같은 키가 되므로, 결정은 한 번 쓰면 `used/`로 표시하고 다음 요청은 새 카드로 만든다 |
| U-01 훅이 기다리는 동안 agents 상태 | `state: blocked, status: waiting, waitingFor: "permission prompt"` — 진짜 확인 창과 같다. 약 6초 뒤 Notification `permission_prompt` | 세션 현황은 이 값으로 권한 대기를 표시하고, 기다리는 명령은 권한 요청 파일과 sessionId로 이어 붙인다 |
| U-03 실행 중 훅 설정 변경 | **바로 반영.** 첫 요청을 결정하기 전에 설정을 v2로 바꾸자 두 번째 요청부터 v2 훅이 돌았다 | 훅 배포·설정 변경에 세션 재시작이 필요 없다. 설치본 교체(deploy)도 다음 호출부터 적용 |
| U-05 입력 대기와 권한 대기 구분 | 일을 마친 세션: `state: done, status: idle`, 약 60초 뒤 Notification `idle_prompt`. 권한 대기: `waitingFor: "permission prompt"`. 확인 창 종류는 waitingFor 값(permission prompt / sandbox request / worker request / dialog open / input needed)으로 갈린다 | 2026-10-07 WY-design 사례(질문하고 멈춤)는 `dialog open`(AskUserQuestion 대화상자)이었을 것으로 본다. 지금 대시보드는 `dialog open`을 **승인 대기**로 잘못 분류한다 → 입력 대기로 옮긴다 |
| 훅 시간 초과 | 훅이 결정 없이 끝나면 평소 흐름(확인 창)으로 간다. **백그라운드 세션에는 확인 창에 답할 사람이 없어 계속 멈춰 있다** | 요구사항 (b)대로 하면 15분 뒤 세션이 무기한 멈춘다 → [결정 요청] Q1 |
| U-04 대화 기록에서 세션 간 메시지 | 받은 쪽: `type:"user", isMeta:true`에 `origin: {kind:"peer", name:<보낸 세션>, msg_id, body}`. 보낸 쪽: assistant의 `tool_use` SendMessage(`to`, `summary`, `message`). 모든 줄에 `timestamp`, `sessionId`, 세션 이름은 `agent-name` 줄. 줄은 즉시 덧붙는다 | 활동 피드 데이터로 쓸 수 있다(10초 안 반영 가능). **공개 계약이 아닌 내부 형식**이라 읽기 모듈이 모르는 형식을 만나면 "읽을 수 없음"을 표시하고 멈추지 않게 한다 |

그 밖에 확인한 것: 신뢰되지 않은 폴더에서는 `claude --bg`가 "Workspace not trusted"로 실패한다(실험은 저장소 안 폴더에서 해야 함).

## 2. 갈래 사이 접점(먼저 정하는 계약)

### 2.1 B2-0 공용 정리 — 다른 두 갈래가 시작하기 전에 WY-backend2가 먼저 끝낸다(반나절)
- `extension.js`의 세션 현황 뷰 코드를 `sessionsView.js`로 옮긴다(동작 그대로). 이후 `sessionsView.js`는 WY-backend1 소유. `extension.js`는 `require('./sessionsView').register(context)` 한 줄만 둔다.
- `activityView.js` 자리(빈 탭을 여는 최소 코드)와 `media/activity.html` 빈 틀을 만든다. 이후 WY-backend3 소유.
- `package.json`에 미리 넣는다: 명령 `erpSessions.revealSession`(세션 현황의 줄로 이동), `wyActivity.open`(활동 탭), 활성화 이벤트 `onWebviewPanel:wyActivity`. 갈래 작업 중 더 필요하면 WY-backend2에 요청한다.
- `deploy.js`를 **커밋본(HEAD) 배포**로 바꾼다(`git archive HEAD tools/wy-ops/vscode`). 다른 갈래의 미커밋 변경이 있어도 커밋된 것만 배포한다.
- `test/fakeVscode.js`(가짜 vscode 모듈)를 공용 테스트 도우미로 둔다. 갈래별 테스트는 `test/<갈래>*.test.js`.

### 2.2 데이터 계약
| 데이터 | 만드는 쪽 | 쓰는 쪽 | 형식 |
|---|---|---|---|
| 권한 요청 파일 | B2 PermissionRequest 훅 | B1(기다리는 명령 표시), B2(카드) | `requests/perm-<key>.json`: `{kind:"permission", key, sessionId, sessionName, tool, toolInput, command, permissionMode, createdAt, expiresAt}` / 결정 `decisions/perm-<key>.json` / 시간 초과 표시 `decisions/perm-<key>.json`의 `decision:"expired"` |
| 세션 등록 기록 | B2 SessionStart 훅 | B1(역할 누락 표시), B2(커밋 세션 경고) | `sessions/<sessionId>.json`: `{sessionId, agentType, startedAt, cwd, source}`(승인 폴더 아래, 셸 쓰기 차단 대상에 추가) |
| 읽기 함수 | B2 `approvalStore.js` | B1 | `listPermissionRequests(root)`, `readSessionRegistry(root)` |
| 세션 상태 | B1 `agentsReader.js`(새 파일) | B1 화면, B3 세션 레인·상태 | `readSessionStatus({root, ops})` → `[{name, id, sessionId, kind, state, status, waitingFor, view: 'working'|'idle'|'input'|'permission'|'stopped'|'failed', pending: {key, tool, command}|null, roleMissing: bool, startedAt}]` |
| 활동 데이터 | B3 `sessionActivity.js` | B3 화면 | 3.3절 |
| "세션 현황에서 보기" | B2 승인 센터 → 명령 `erpSessions.revealSession`(sessionId) | B1이 명령 처리 | |
| 대기 중 종료된 세션(2026-10-07 추가) | Claude Code(`claude agents`의 `state`) | B1 표시, B2 메시지 훅 | `state:"done"`은 세션이 스스로 끝난 것(pid·status 없음), `"stopped"`는 `claude stop`으로 멈춘 것. B1은 역할 세션의 최신 백그라운드가 done이면 view `ended`("대기 중 종료됨", 경고 색)로 따로 표시. B2는 SendMessage 대상이 이 상태면 보내기 전에 알린다(B2-6) |

## 3. 갈래별 계획

### 3.1 WY-backend2 — 승인 센터·훅·공용 연결 (OPS-01~03, 06)
**파일(단독 소유)**: `extension.js`, `package.json`, `deploy.js`, `approvalCenter.js`, `approvalStore.js`, `opsConfig.js`, `hooks/*`(새 `wy-permission.js`, `wy-session-start.js`), `media/approvals.*`, `README.md`, `test/fakeVscode.js`, `test/approvals*.test.js`, `test/hooks*.test.js`

| 단위(커밋) | 내용 | 완료 조건(수용 기준) | 검증 |
|---|---|---|---|
| B2-0 | 2.1 공용 정리 | 동작 변화 없음, 세 갈래가 각자 파일만 고칠 수 있음 | 기존 가짜 vscode 검사 통과, 배포본 diff 없음 |
| B2-1 신뢰성 | (0) 가드 훅 리다이렉트 오탐 수정: 보호 파일 이름이 명령에 나오기만 해도 다른 곳으로의 리다이렉트까지 막던 것을, 대상이 보호 경로이거나 대상을 알 수 없을 때(변수·명령 치환)만 막도록 좁힌다(WY-commit이 커밋 메시지 파일을 쓰다 걸림). 쓰기 프로그램도 그 조각의 대상이 보호 경로·변수일 때만 (1) 위조 감지: 확장이 쓴 결정의 id·해시를 VS Code globalState에 기록하고, 기록에 없는 결정 파일은 "출처 불명 결정" 경고 카드로 띄운다(세션은 globalState를 쓸 수 없음). 가드 훅 쓰기 차단에 `sessions/` 추가 (2) SessionStart 훅이 `agent_type`을 기록, 이름이 커밋 세션인데 agentType이 다르면 승인 센터 위에 경고 (3) 대기 카드·권한 카드는 파일이라 리로드 뒤에도 남는다. 권한 카드는 세션이 사라지면 "세션 끝남"으로 바꾼다 | OPS-06 (1)(2)(3) | 위조 시도 묶음(Edit·Write는 deny 3줄 적용 뒤 시험 세션으로, 셸은 훅 검사), `--agent` 없이 띄운 커밋 이름 세션이 경고로 보임, 카드 만든 뒤 Reload 해도 그대로 |
| B2-2 카드 형식 | 공통 칸 `what`·`why`·`onClick` 필수, 선택지마다 `cost` 필수(OPS-03). 빈 칸이 있으면 형식 오류 카드("필수 칸 없음: …")로 올라가 처리 버튼이 없다. 결정 카드(choice) 선택지에 대가·누르면 일 표시 | OPS-03 | 칸 누락 요청 4종이 형식 오류로 보임, 정상 카드에 네 칸 표시 |
| B2-3 할 일 카드 | 새 종류 `todo`: 방법 단계(`steps`), 확인 방법, [했음] 버튼(메모 선택). 결정 `decision:"done"`. 요청 세션은 지금 규약(until 루프·decisions.log)으로 받아 이어 간다 | OPS-02 ③: "했음" 뒤 대화창 알림 없이 세션이 이어 감 | 가짜 vscode 왕복, 시험 세션이 할 일 카드 → 했음 → 다음 단계 실행 |
| B2-4 권한 카드 | `hooks/wy-permission.js`(PermissionRequest): 키 = sha1(session_id·tool_name·tool_input) 16자, 권한 요청 파일을 쓰고 결정을 최대 15분 기다림(훅 timeout 960초). 허용은 그 한 번만(updatedPermissions 안 씀), 거부는 사유를 세션에 돌려줌, 시간 초과는 Q1 결정대로. PermissionDenied 훅: 분류기가 막은 명령을 할 일 카드("직접 실행", 명령 복사)로 올림. 카드에는 허용·거부와 "세션 현황에서 보기" 링크만(D-89) | OPS-02 ① 수용 기준 전부(허용 → attach 없이 진행, 거부 사유 전달, 15분 시간 초과 표시, deny·분류기 거부는 ①이 아님) | 시험 세션(실험과 같은 방식, ask 규칙)으로 허용·거부·시간 초과 3회. 훅 단위 검사(키 계산, 한 번만 사용, 결정 파일 위조 거부) |
| B2-5 승인 센터 화면 | 새 종류(할 일·권한·형식 오류·출처 불명) 카드, 커밋 세션 경고, "활동" 탭 열기 버튼. 디자인은 4단계에서 목업으로 바꾸므로 지금은 기존 스타일 유지 | OPS-01: 처리 전 카드가 사라지지 않음 | 가짜 DOM 검사(지난 방식) |

| B2-6 메시지 대상 확인(2026-10-07 추가) | `hooks/wy-message-guard.js`(PreToolUse, matcher `SendMessage`): 대상 이름의 최신 백그라운드 세션이 끝나 있으면(done·stopped·failed, 같은 이름의 살아 있는 세션 없음) 보내기를 거부하고 사유("대상 세션이 대기 중 종료됨 — WY-pm에 알리거나 session.ps1 start로 다시 띄우세요")를 돌려준다. 살아 있거나 대화형 세션이면 통과. `claude agents`를 못 읽으면 통과(평소 흐름) | 오늘 두 번 있었던 '대기 중 종료 → 메시지 유실'을 보내는 쪽이 바로 안다 | 훅 단위 검사(살아 있음·done·stopped·대화형·이름 없음·agents 실패), 시험 세션을 끝낸 뒤 그 이름으로 보내 거부 확인 |

**사용자 손(B2 끝에 한 번)**: settings.local.json 수정(5장), Reload Window.

### 3.2 WY-backend1 — 세션 현황 (OPS-04, OPS-06 4)
**파일(단독 소유, B2-0 이후)**: `sessionsView.js`, `agentsReader.js`(새), `media/panel.*`, `test/sessions*.test.js`

| 단위(커밋) | 내용 | 완료 조건 | 검증 |
|---|---|---|---|
| B1-1 상태 읽기 | `agentsReader.js`: `claude agents --json --all` + 권한 요청 파일 + 세션 등록 기록을 합쳐 2.2 형식으로. 분류: waitingFor `permission prompt`·`sandbox request`·`worker request` → 권한 대기, `dialog open`·`input needed`·state `done`+idle → 입력 대기(지금 잘못된 `dialog open` 분류 고침, U-05) | 권한 대기 줄에 기다리는 도구·명령 표시, 움직이면 사라짐 | 단위 검사(상태 조합 표), 시험 세션 권한 대기 표시 |
| B1-2 열기 | 줄마다 [열기]: VS Code 새 터미널에서 `claude.cmd attach <id>`(실행 정책 때문에 .cmd). WY-commit(설정의 commitRole) 줄은 "나온 뒤 교대가 필요할 수 있음" 경고 대화상자 뒤 열기 | OPS-04 열기, OPS-06 (4) 경고 | 가짜 vscode로 터미널 명령 확인, 실제 열기 1회(사용자) |
| B1-3 역할 누락·이동 | 등록 기록의 agentType이 역할 이름과 다르면 "역할 누락" 배지. `erpSessions.revealSession`으로 해당 줄 강조 | OPS-06 (4), OPS-04 "세션 현황에서 보기" | 단위 검사, 승인 센터 링크로 이동 확인 |

접점: B2의 `listPermissionRequests`·`readSessionRegistry`를 쓴다(B2-1·B2-4 전에는 빈 목록으로 동작). 명령 등록은 `sessionsView.register(context)` 안에서 한다.

### 3.3 WY-backend3 — 활동 피드 (OPS-09)
**파일(단독 소유, B2-0 이후)**: `sessionActivity.js`(새), `activityView.js`, `media/activity.*`, `test/activity*.test.js`

| 단위(커밋) | 내용 | 완료 조건 | 검증 |
|---|---|---|---|
| B3-1 읽기 모듈 | 대화 기록 폴더(저장소 경로에서 계산)의 `*.jsonl`을 파일별 오프셋으로 증분 읽기. 받은 메시지(`origin.kind:"peer"`)를 기준으로 {보낸 세션, 받은 세션, 시각, 요약(첫 줄), 원문, msg_id}. 받은 쪽 기록이 없는 메시지는 보낸 쪽 SendMessage로 채움(msg_id로 중복 제거). 처음 열 때는 파일 끝 일부만 읽어 빠르게. 모르는 형식은 건너뛰고 "읽을 수 없음" 수를 셈 | 두 세션이 메시지를 주고받으면 10초 안에 피드에 보임 | 실제 기록 표본으로 단위 검사, 시험 세션 두 개 주고받기 |
| B3-2 활동 탭 | 시간순 피드(요약 → 한 번 클릭으로 원문), 세션별 상태(B1 `agentsReader` 사용), 결함 흐름 묶음: 메시지의 첫 ID(예: `P1-03-02`, `TC-…`, `D-nn`, `OPS-nn`)와 머리표([결함]·[완료]·재검증)로 묶어 단계 순서 표시 | OPS-09 세 수용 기준 | 가짜 DOM 검사, 실제 기록으로 묶음 확인 |

접점: 세션 상태는 B1 `agentsReader.readSessionStatus`를 가져다 쓴다(B1-1 전에는 `claude agents`만으로 대체). 탭 열기 명령은 B2-0에서 등록.

### 3.4 4단계(OPS-08 디자인)와 5단계(패키지화)
- 디자인: 세 갈래가 끝난 뒤 목업(받은편지함·상세, 종류 아이콘·색, 우선순위·대기 시간, 한 번 클릭, j/k 단축키, 남은 수 배지, 라이트·다크)으로 승인 센터·세션 현황·활동 화면을 바꾼다. **WY-design**이 목업 대조와 `/impeccable audit`, 화면 코드는 각 갈래 소유자가 자기 파일에서. 활동 탭을 승인 센터 탭 안으로 합칠지는 이때 정한다(Q2).
- 패키지화(OPS-07): OPS-01~06 수용 기준을 운영에서 통과한 기록이 생긴 뒤 6단계를 다시 시작한다(6장).

## 4. 순서와 일정(대략)
1. B2-0(반나절) → 커밋 → 세 세션에 시작 알림
2. 병렬: B2-1~5(약 2.5일), B1-1~3(약 1.5일), B3-1~2(약 2일). 갈래마다 단위가 끝날 때 WY-commit에 직접 커밋 요청, 배포(deploy)는 WY-backend2가 커밋본으로 한다(다른 갈래는 배포 요청만)
3. 통합 확인(반나절): 시험 세션으로 네 종류 카드·세션 현황·활동 피드 한 번에 확인 → OPS-01~06·09 수용 기준 기록
4. 사용자 손(한 번에): 5장의 설정 수정 → Reload → 실제 운영으로 확인

## 5. 사용자 손이 필요한 일(통합 확인 직전 한 번, 할 일 카드로 올림)
1. `.claude/settings.local.json` 수정(D-87: 세션은 못 고침). 정확한 diff는 B2-4가 끝날 때 WY-pm에 보낸다. 들어갈 것:
   - `permissions.deny`: 결정 위조 차단 3줄(이미 카드로 올라감, 아직이면 함께)
   - `hooks.PermissionRequest`: `node ~/.wy-tools/vscode-dashboard/hooks/wy-permission.js`, timeout 960
   - `hooks.PermissionDenied`: 같은 스크립트(`--denied`)
   - `hooks.SessionStart`: `node …/hooks/wy-session-start.js`, timeout 10
   - `hooks.PreToolUse`에 matcher `SendMessage` 항목: `node …/hooks/wy-message-guard.js`, timeout 15(B2-6)
2. VS Code `Developer: Reload Window`
3. 확인: WY-commit 줄 "열기" 1회(경고 → 터미널 attach)
훅 변경은 실행 중인 세션에 바로 반영되므로(U-03) 세션 재시작은 필요 없다.

## 6. wy-ops 6단계 미커밋 변경 (U-02)
- 경위: 2026-10-07 가드 훅 긴급 수정 때 WY-backend2가 6단계 미커밋 변경(이동·id 변경)을 워킹트리에서 되돌렸다(`git show HEAD:` 덮어쓰기와 `rm`, 금지 명령은 안 씀). 사용자 결정은 "구현 단계까지 그대로"였으므로 절차 위반이다. 되돌리기 직전 상태는 `C:\projects\erp-project-wyops6-backup\`에 있다(tools/wy-ops 전체 사본, 추적 파일 diff, 상태 목록).
- 판단: **지금 복구하지 않는다(추천).** 6단계는 확장 id·폴더를 바꾸는 작업이라, 지금 복구하면 세 갈래가 옛 위치·새 위치 중 어디를 고칠지 갈리고 배포·훅 경로도 둘이 된다. OPS-07대로 OPS-01~06이 안정된 뒤 그 시점의 HEAD에서 이동을 다시 하고(기계적 작업), 백업은 참고로만 쓴다. 6단계가 끝나면 사용자가 백업 폴더를 지운다.

## 7. 위험
- 대화 기록(*.jsonl)과 `claude agents` 출력은 공개 계약이 아니다. Claude Code 업데이트로 바뀔 수 있다 → 읽기 모듈은 모르는 형식을 건너뛰고 화면에 "읽을 수 없음"을 표시, 업데이트 뒤 검사 표본으로 다시 확인.
- 셸 쓰기 차단은 휴리스틱이다. `node -e "require('./다른스크립트')"`처럼 다른 파일을 불러 간접 실행하면 막지 못한다(WY-commit 지적). Edit·Write는 deny 규칙이 막고, 남는 간접 실행은 B2-1의 출처 불명 결정 감지로 잡는다.
- 권한 카드는 ask 규칙·보호 경로가 걸린 명령에만 뜬다(auto 모드). 지금 settings에는 ask 규칙이 없으므로, 실제로 권한 대기가 생기는 경우는 드물다. 분류기 거부가 더 흔할 수 있어 PermissionDenied → 할 일 카드가 중요하다.
- 세 갈래가 같은 폴더(`tools/wy-ops/vscode`)에서 일하므로, 배포는 커밋본 기준(B2-0)으로만 한다.

## 8. 결정 (2026-10-07 확정)

| 항목 | 결정 |
|---|---|
| Q1 권한 카드 15분 시간 초과 | A — 훅이 사유와 함께 거부를 돌려준다(요구사항 (b) 문구는 WY-planner가 "거부로 닫힘"으로 수정) |
| Q2 활동 탭 위치 | A — 우선 별도 탭, 디자인 단계에서 합칠지 결정 |
| Q3 위조의 남은 구멍 | A — 확장 globalState 기록과 대조해 출처 불명 결정 경고 |
| Q4 6단계 미커밋 변경 | A — 지금 복구하지 않고 패키지화 단계에서 그때의 HEAD로 다시 |
| [pm 결정] | 결정 키 sha1(session_id·tool_name·tool_input) 16자(D-82 (d) 문구는 WY-planner가 수정) / `dialog open`은 입력 대기 / 배포는 커밋본(HEAD) 기준 |

아래는 결정 당시의 선택지(기록용).
- **Q1 권한 카드 시간 초과(15분)**: A 결정 없이 15분이 지나면 훅이 **거부**를 돌려주고 사유("승인 센터에서 15분 동안 결정 없음 — 다시 요청하거나 할 일 카드로")를 세션에 준다(추천: 세션이 멈추지 않고 다음 행동을 할 수 있다) / B 요구사항 원문대로 평소 흐름(확인 창)으로 — 백그라운드 세션은 attach하기 전까지 계속 멈춘다. A는 요구사항 (b) 문구를 "안전한 쪽(거부)으로 닫힌다"로 바꾸는 것이다.
- **Q2 활동 탭 위치**: A 지금은 별도 탭, 디자인 단계에서 승인 센터 안으로 합칠지 결정(추천: 세 갈래가 파일을 나눠 동시에 진행 가능) / B 처음부터 승인 센터 탭 안(목업 배치 그대로, 그러나 B3가 B2 파일을 기다려야 함)
- **Q3 결정 위조의 남은 구멍**: A 감지(확장 globalState 기록과 대조, 출처 불명 결정 경고)로 보완(추천) / B 더 막기(인터프리터가 실행하는 스크립트 파일 내용까지 검사 — 오탐이 늘고 여전히 완전하지 않음)
- **Q4 6단계 미커밋 변경**: A 지금 복구하지 않고 5단계에서 다시 함(추천, 6장) / B 지금 백업으로 복구(갈래 작업 전에 위치를 바꾼 뒤 시작, 확장 재설치와 settings 훅 경로 변경이 먼저 필요)
- pm이 정할 구현 세부(알림만): 결정 키를 sha1(session_id·tool_name·tool_input)로(tool_use_id 없음), `dialog open`을 입력 대기로 재분류, 배포를 커밋본 기준으로.

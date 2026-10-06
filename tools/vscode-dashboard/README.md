# 세션 현황 대시보드 · WY 승인 센터 (VS Code 확장)

VS Code 사이드바에서 메모리, 프로세스 그룹별 사용량, Claude 역할 세션 상태를 본다. 작업창 탭 'WY 승인 센터'에서는 세션이 올린 git 명령 요청(커밋·푸시·PM 결정)을 승인·거부하고, 선택지 결정 요청에 답한다. npm 의존성과 빌드 단계가 없다.

## 개발본과 설치본

이 폴더(`tools/vscode-dashboard`)는 개발본이다. VS Code에는 저장소 밖 설치 폴더 `~/.wy-tools/vscode-dashboard`를 설치한다. 그래서 개발 중인 파일이 쓰는 확장에 바로 실리지 않는다. 승인 가드 훅도 설치 폴더의 스크립트를 쓴다.

### 처음 설치(한 번만)

1. 저장소 루트에서 `node tools/vscode-dashboard/deploy.js`를 실행한다. 설치 폴더가 만들어진다.
2. 저장소 폴더를 가리키는 예전 설치본이 있으면 확장 보기에서 'ERP 세션 현황'을 제거한다.
3. 명령 팔레트(Ctrl+Shift+P)에서 `Developer: Install Extension from Location...`을 실행하고 `~/.wy-tools/vscode-dashboard`(예: `C:\Users\<사용자>\.wy-tools\vscode-dashboard`)를 고른다.
4. `Developer: Reload Window`를 실행한다. 활동 막대에 '세션 현황' 아이콘이, 상태 표시줄에 '승인 대기'가 생긴다.

### 갱신

1. 바뀐 코드가 커밋된 뒤 `node tools/vscode-dashboard/deploy.js`를 실행한다. 커밋 안 된 변경이 있으면 거부한다(`--force`로 무시). 새 폴더를 다 만든 뒤 이름을 바꿔 한 번에 교체하므로 반쯤 복사된 상태가 남지 않는다.
2. `Developer: Reload Window`를 실행한다. 다시 설치할 필요는 없다(같은 폴더라서).

설치 폴더의 `deployed.json`에 배포한 버전·커밋·시각이 남는다.

## 세션 현황(사이드바)

| 항목 | 출처 | 주기 |
|---|---|---|
| 전체·여유 메모리 | Node `os.totalmem`·`os.freemem` | 5초 |
| 프로세스 그룹 상위 5개 | `tasklist /fo csv /nh` | 15초 |
| 세션 | `claude agents --json --all` | 10초 |

- 패널이 보이지 않으면 폴링을 멈춘다. 위 오른쪽 새로고침 버튼으로 바로 갱신할 수 있다.
- 프로세스 블록은 제목을 눌러 접을 수 있다. 접어 두면 `tasklist`를 실행하지 않고, 접힘 상태는 패널을 다시 열어도 유지된다.
- 세션은 갱신 때마다 작업 중 → 대기(대기·입력 대기·승인 대기) → 멈춤 → 오류 → 없음 순으로 다시 정렬한다. 같은 그룹 안은 저장소 `CLAUDE.md`의 세션 역할 표 순서다. 띄우지 않은 역할은 '없음'으로 보여 준다. 워크스페이스 루트가 저장소여야 한다.
- 입력 대기는 할 일을 마치고 다음 지시를 기다리는 상태, 승인 대기는 권한·샌드박스·선택 대화상자 응답을 기다리는 상태다(`claude agents`의 `waitingFor`로 구분). 상태 위에 마우스를 올리면 기다리는 이유가 보인다.
- 여유 메모리가 1GB 미만이면 막대와 문구가 경고색으로 바뀐다. 막대 위의 세로선이 1GB 기준이다.

## WY 승인 센터(작업창 탭)

상태 표시줄의 '승인 대기 N'을 누르거나 명령 팔레트에서 `WY: 승인 센터 열기`를 실행한다. VS Code를 다시 열면 탭이 되살아난다. N은 git 명령 요청과 결정 요청을 합친 수이고, 마우스를 올리면 나눠서 보인다.

- **git 명령 카드**: 커밋·푸시(파랑)와 PM 결정(노랑: 병합·`gh pr merge`, 브랜치 생성·삭제, reset, 강제 푸시, rebase, 태그 삭제). 매번 [승인] 또는 [거부]를 누른다. 자동 승인은 없다. 거부할 때는 사유를 적어야 한다.
- **결정 카드**(보라): 질문 1~4개, 질문마다 선택지 2~4개(추천 표시), 하나만 또는 여러 개 고르기, '기타' 직접 입력, 메모. 모든 질문에 답해야 [보내기]가 된다.

### 파일(저장소 밖 `~/.claude/wy-approvals/`)

| 경로 | 쓰는 쪽 | 내용 |
|---|---|---|
| `requests/<id>.json` | 요청하는 세션 | 요청 하나 |
| `decisions/<id>.json` | 확장 | 그 요청의 결정. 요청과 같은 id |
| `decisions.log` | 확장 | 결정마다 JSON 한 줄을 덧붙인다(알림용) |
| `used/<id>.json` | 가드 훅 | 그 승인으로 명령을 한 번 실행했다는 표시 |

- id는 영문·숫자·`.`·`_`·`-`로 80자 이내, 요청을 쓰는 세션이 정한다. 겹치지 않게 `<날짜>-<시각>-<세션>-<짧은 설명>`을 권한다(예: `20261006-1530-WY-pm-p2-scope`).
- 요청 파일도 임시 이름으로 다 쓴 뒤 `<id>.json`으로 이름을 바꿔 둔다. 반쯤 쓴 파일은 형식 오류 카드로 보인다.
- 요청 파일은 결정 뒤에도 지우지 않는다(최근 결정 목록이 제목을 보여 줄 때 쓴다).

### 요청 형식

공통 필드: `kind`, `session`(요청 세션 이름, 결정을 전해 받을 곳), `createdAt`, `title`, `relatedSessions`(선택, 결정을 함께 알아야 할 세션), `detail`(선택).

git 명령 요청(`kind`: `commit` `push` `force-push` `branch` `delete-branch` `merge` `reset` `rebase` `tag-delete`):

```json
{
  "kind": "commit",
  "session": "WY-commit",
  "createdAt": "2026-10-06T15:30:00+09:00",
  "title": "feat(tools): 승인 센터 2단계",
  "branch": "feature/P1",
  "command": "git commit -F .git/WY_COMMIT_MSG",
  "files": ["tools/vscode-dashboard/approvalStore.js"],
  "commits": [{ "hash": "5795e03", "subject": "feat(tools): …" }],
  "verification": "node --check 통과, 가짜 vscode 로드 통과",
  "relatedSessions": ["WY-backend2"],
  "detail": "WY-backend2 요청분"
}
```

- `command`: 실제로 실행할 명령 그대로. 가드 훅은 공백만 정리해 실행 명령과 똑같은지 비교한다. 여러 명령을 `&&`로 이을 때는 잠금 대상 명령마다 요청을 하나씩 쓴다.
- push 요청은 `commits`에 올라갈 커밋을, commit 요청은 `files`(또는 `fileCount`)와 `verification`을 채운다.

결정 요청(`kind`: `choice`, AskUserQuestion과 같은 모양):

```json
{
  "kind": "choice",
  "session": "WY-pm",
  "createdAt": "2026-10-06T16:00:00+09:00",
  "title": "P2 시작 범위",
  "background": "P1 QA가 끝났고 남은 결함 2건은 P2 첫 주에 고칠 수 있다.",
  "relatedSessions": ["WY-planner", "WY-backend1"],
  "questions": [
    {
      "header": "시작 시점",
      "question": "P2를 언제 시작할까요?",
      "multiSelect": false,
      "options": [
        { "label": "바로 시작", "description": "결함은 P2와 함께 고친다", "recommended": true },
        { "label": "결함 먼저", "description": "남은 2건을 고친 뒤 시작한다" }
      ]
    },
    {
      "header": "먼저 할 일",
      "question": "P2에서 먼저 할 영역을 고르세요.",
      "multiSelect": true,
      "allowOther": true,
      "options": [
        { "label": "알림" },
        { "label": "통계" },
        { "label": "모바일 화면" }
      ]
    }
  ]
}
```

- `questions` 1~4개, 질문마다 `options` 2~4개(`label`은 질문 안에서 겹치지 않게). `header`는 짧은 라벨(24자 이내).
- `multiSelect`(기본 false), `allowOther`(기본 true: '기타' 직접 입력 칸을 보여 준다), `recommended`(선택지에 '추천' 표시).

### 결정 형식

`decisions/<id>.json`은 임시 파일에 다 쓴 뒤 이름을 바꿔 생긴다. 그래서 **파일이 보이면 완성된 결정**이고 `done: true`가 들어 있다(`*.tmp`는 무시한다).

```json
{
  "id": "20261006-1600-WY-pm-p2-scope",
  "kind": "choice",
  "session": "WY-pm",
  "relatedSessions": ["WY-planner", "WY-backend1"],
  "decision": "answered",
  "answers": [
    { "question": "P2를 언제 시작할까요?", "header": "시작 시점", "selected": ["바로 시작"], "other": null },
    { "question": "P2에서 먼저 할 영역을 고르세요.", "header": "먼저 할 일", "selected": ["알림"], "other": "로그인 화면 다듬기" }
  ],
  "note": "결함 2건은 WY-qa 재확인 후 닫기",
  "by": "user",
  "decidedAt": "2026-10-06T07:05:12.345Z",
  "done": true
}
```

- git 명령 결정은 `decision`이 `approved` 또는 `rejected`이고, `reason`(거부 사유)과 `command`(정리한 명령)가 들어 있다.
- `decisions.log`에는 같은 결정이 한 줄로 붙는다: `{"id":"…","kind":"choice","session":"WY-pm","relatedSessions":[…],"decision":"answered","decidedAt":"…"}`

### 결정을 받는 방법(기다리지 않아도 되게)

요청한 세션은 요청 파일을 쓴 뒤 결정을 기다리며 멈춰 있을 필요가 없다. 결정 파일은 지워지지 않으니 나중에 읽어도 된다.

- **id 하나를 기다릴 때**(요청한 세션이 직접): `decisions/<id>.json`이 생길 때까지 확인한다. 예(Bash, Monitor의 until 루프):
  `until [ -f ~/.claude/wy-approvals/decisions/<id>.json ]; do sleep 5; done; cat ~/.claude/wy-approvals/decisions/<id>.json`
- **모든 결정을 감시할 때**(WY-pm): `decisions.log`에 새 줄이 붙는지 본다. 예:
  `tail -n 0 -F ~/.claude/wy-approvals/decisions.log`
  새 줄의 `session`·`relatedSessions`를 보고, 그 세션이 멈춰 있으면 깨워서(`session.ps1 start <역할> "<결정 요약>"`) 결정 파일 경로와 요약을 전한다.
- 가드 훅은 승인 파일을 **읽는** 셸 명령(cat·ls·tail·test·감시 루프)은 통과시키고, **쓰는** 명령만 막는다.

### 세션별 사용 규칙(초안)

- **WY-commit**: 잠금 대상 git 명령마다 git 요청 파일을 쓰고 결정을 받은 뒤, approved면 `command`를 그대로 실행한다. rejected면 실행하지 않고 `reason`을 요청 세션과 WY-pm에 전한다. 승인은 결정 후 60분 안에 한 번만 쓸 수 있다. PM 결정 종류는 요청 전에 WY-pm에 알린다. 반드시 `--agent WY-commit`으로 띄운 세션이어야 한다(가드 훅이 agent_type을 본다).
- **WY-pm**: 사용자에게 물을 결정은 choice 요청으로 올리고 `decisions.log`를 감시한다. 결정이 오면 `session`·`relatedSessions`에 전하고, 확정된 결정은 WY-planner가 `docs/결정기록.md`에 기록하게 한다.
- **다른 역할 세션**: git 명령 요청은 쓰지 않는다(WY-commit에 커밋을 요청한다). 사용자 판단이 필요한 결정은 WY-pm에 `[결정 요청]`으로 보내고, WY-pm이 choice 요청으로 올린다.
- **모든 세션**: `decisions/`·`decisions.log`·`used/`·설치 폴더에 쓰지 않는다. 결정 파일은 Read 도구나 읽기 명령으로 본다. 확장을 고칠 때 가드 훅이 막는 셸 명령(보호 경로가 들어간 node·sed 스크립트 등)은 쓰지 말고 Edit 도구로 고친다.

## 승인 가드 훅

`hooks/wy-approval-guard.js`는 Bash·PowerShell 도구의 PreToolUse 훅이다.

- 잠금 대상 git 명령(commit, push, 강제 푸시, 브랜치 생성·삭제, merge·`gh pr merge`, reset, rebase, 태그 삭제)은 `--agent WY-commit`으로 띄운 세션만 실행할 수 있다. agent_type이 없는 세션도 거부한다. 조회 명령(status, log, diff 등)은 누구나 쓴다.
- WY-commit이라도 같은 종류·같은 명령의 승인 결정(결정 후 60분 이내, 아직 안 씀)이 없으면 거부하고, 요청 파일을 쓰라는 사유를 돌려준다.
- `merge --abort`, `rebase --abort`처럼 되돌리는 명령은 잠그지 않는다.
- 승인 파일·설치 폴더에 쓰는 셸 명령을 막는다: 그 경로로의 리다이렉트(`>`·`>>`), 쓰기 명령(cp·mv·rm·tee·Set-Content·Out-File·Remove-Item 등, `sed -i`, `find -delete`/`-exec`), 그 경로를 언급하는 인터프리터(node·python·powershell·bash 등). 읽기 명령은 통과한다.
- 훅은 오류·시간 초과 때 통과시키는 특성이 있어서, 이 스크립트는 판단하지 못하면 종료 코드 2로 막는다. 다만 설정에 적힌 스크립트 경로가 없거나 `node`를 못 찾으면 Claude Code가 훅을 건너뛴다(통과).

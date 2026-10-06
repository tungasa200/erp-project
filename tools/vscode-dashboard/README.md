# 세션 현황 대시보드 · WY 승인 센터 (VS Code 확장)

VS Code 사이드바에서 메모리, 프로세스 그룹별 사용량, Claude 역할 세션 상태를 본다. 작업창 탭 'WY 승인 센터'에서는 세션이 올린 커밋·푸시·PM 결정 요청을 승인하거나 거부한다. npm 의존성과 빌드 단계가 없다.

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

상태 표시줄의 '승인 대기 N'을 누르거나 명령 팔레트에서 `WY: 승인 센터 열기`를 실행한다. VS Code를 다시 열면 탭이 되살아난다.

- 토글 '커밋 자동 승인'은 `git commit`, '푸시 자동 승인'은 일반 `git push`(fast-forward)만 바로 승인한다. 켜면 대기 중인 같은 종류 요청도 바로 승인된다.
- PM 결정(병합·`gh pr merge`, 브랜치 생성·삭제, reset, 강제 푸시, rebase, 태그 삭제)은 토글과 상관없이 늘 카드로 확인한다.
- 거부할 때는 사유를 적어야 한다. 사유는 결정 파일에 남아 요청한 세션이 읽는다.

### 파일(저장소 밖 `~/.claude/wy-approvals/`)

| 경로 | 쓰는 쪽 | 내용 |
|---|---|---|
| `config.json` | 확장 | `{ "autoApprove": { "commit": false, "push": false } }` |
| `requests/<id>.json` | 세션(WY-commit) | 승인 요청 |
| `decisions/<id>.json` | 확장 | 결정 |
| `used/<id>.json` | 가드 훅 | 그 결정으로 명령을 한 번 실행했다는 표시 |

### WY-commit 요청 규약(초안)

1. 명령마다 요청 파일 하나를 `requests/<id>.json`에 쓴다. id는 영문·숫자·`.`·`_`·`-`로 80자 이내(예: `20261006-1530-commit-tools`).

   ```json
   {
     "kind": "commit",
     "session": "WY-commit",
     "createdAt": "2026-10-06T15:30:00+09:00",
     "title": "feat(tools): 승인 센터 1단계",
     "branch": "feature/P1",
     "command": "git commit -F .git/WY_COMMIT_MSG",
     "files": ["tools/vscode-dashboard/extension.js"],
     "commits": [{ "hash": "089f5a2", "subject": "feat(tools): …" }],
     "verification": "node --check 통과, 가짜 vscode 로드 13/13",
     "detail": "요청한 세션: WY-backend2"
   }
   ```

   - `kind`: `commit` `push` `force-push` `branch` `delete-branch` `merge` `reset` `rebase` `tag-delete`
   - `command`: 실제로 실행할 명령 그대로. 가드 훅은 공백만 정리해 실행 명령과 똑같은지 비교한다. 여러 명령을 `&&`로 이을 때는 잠금 대상 명령마다 요청을 하나씩 쓴다.
   - push 요청은 `commits`에 올라갈 커밋을, commit 요청은 `files`·`fileCount`와 `verification`을 채운다.
2. `decisions/<id>.json`이 생길 때까지 2초 간격으로 확인한다(최대 30분). 그 사이 `config.json`의 해당 토글이 켜지면 확장이 바로 자동 승인 결정을 쓴다.
3. 결정 파일의 `decision`이 `approved`면 `command`를 그대로 실행하고, `rejected`면 실행하지 않고 `reason`을 요청한 세션에 전한다. 승인은 결정 후 60분 안에 한 번만 쓸 수 있다.
4. 세션은 `config.json`·`decisions/`·`used/`를 쓰지 않는다. 결정 파일은 Read 도구로 읽는다(가드 훅이 이 경로를 언급하는 셸 명령을 막는다).

## 승인 가드 훅(초안)

`hooks/wy-approval-guard.js`는 Bash·PowerShell 도구의 PreToolUse 훅이다. 설정에 넣어야 동작한다.

- 잠금 대상 git 명령(commit, push, 강제 푸시, 브랜치 생성·삭제, merge·`gh pr merge`, reset, rebase, 태그 삭제)은 `--agent WY-commit`으로 띄운 세션만 실행할 수 있다. agent_type이 없는 세션도 거부한다. 조회 명령(status, log, diff 등)은 누구나 쓴다.
- WY-commit이라도 토글(commit·push만) 또는 같은 명령의 승인 결정이 없으면 거부하고, 요청 파일을 쓰라는 사유를 돌려준다.
- `merge --abort`, `rebase --abort`처럼 되돌리는 명령은 잠그지 않는다.
- 훅은 오류·시간 초과 때 통과시키는 특성이 있어서, 이 스크립트는 판단하지 못하면 종료 코드 2로 막는다. 다만 설정에 적힌 스크립트 경로가 없거나 `node`를 못 찾으면 Claude Code가 훅을 건너뛴다(통과).

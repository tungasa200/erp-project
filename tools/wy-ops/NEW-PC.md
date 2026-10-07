# 새 PC 체크리스트

`install.ps1 setup`·`global`이 끝에 이 파일을 그대로 보여 준다. 설치 명령이 대신할 수 없는 손일만 적었다. 자동으로 확인할 수 있는 것은 `install.ps1 doctor`가 보고, 승인 센터가 뜬 뒤에는 남은 일이 ③ 할 일 카드로 올라온다.

## 1. 설치 전에 있어야 하는 것

설치 명령은 아래를 설치하지 않는다. 없으면 doctor의 '전제 도구'가 실패한다.

- Windows 10 이상, PowerShell 5.1
- Git, Node 18 이상, VS Code(명령 팔레트 → `Shell Command: Install 'code' command in PATH`), Claude Code CLI
- Claude Code 로그인(`claude`를 한 번 실행해 로그인)
- Claude Code 폴더 신뢰: 운영 도구를 쓸 저장소(새 프로젝트도) 폴더의 터미널에서 `claude`를 한 번 실행해 'Do you trust the files in this folder?'에 Yes를 누르고 `/exit`. VS Code의 '작성자 신뢰'와는 따로이고, 이것이 없으면 백그라운드 역할 세션이 'Workspace not trusted'로 뜨지 않는다.

## 2. 로그인

- [ ] GitHub CLI: `gh auth login` 뒤 `gh auth status`가 Logged in이면 된다(커밋 세션이 PR·CI 확인에 쓴다). doctor가 확인한다.
- [ ] 외부 콘솔(Railway, Vercel 등): 브라우저에서 사용자가 로그인한다. 2단계 인증은 자동화 브라우저에서 막히므로 사람이 한다.

## 3. 사용자가 직접 옮기는 것

패키지는 아래를 옮기지 않는다.

- [ ] 사용자 전역 지침 `~/.claude/CLAUDE.md`
- [ ] 사용자 스킬 `~/.claude/skills/`
- [ ] VS Code 사용자 설정: Settings Sync 등 평소 쓰는 방법으로
- [ ] 비밀값 폴더: 저장소 밖에 있다. 위치는 프로젝트 `.claude/wy-ops.json`의 `secretsDir`를 본다(erp-project는 `C:\projects\worklog-secret\`). 암호화된 USB나 비밀번호 관리자처럼 안전한 방법으로 옮긴다. 메신저·메일·클라우드 공유로 보내지 않는다. 세션은 이 폴더를 읽기만 한다.

## 4. 역할별 외부 준비

그 역할 세션을 띄울 PC에만 하면 된다.

- [ ] WY-qa: agent-browser(`npm install -g agent-browser`). 브라우저 자동화는 자기 세션 이름으로 따로 띄운다.
- [ ] WY-browser:
  - 전용 Chrome 프로필을 만들고, 원격 디버깅 포트 9222(CDP)로 띄우는 바로 가기를 만든다.
  - 그 프로필에서 외부 콘솔(GitHub, Railway, Vercel)에 로그인해 둔다. Google 로그인은 자동화 브라우저에서 막히므로 사람이 한다.
- [ ] 개발 역할(백엔드·프론트): 저장소 README의 버전 표(JDK, Docker 등)를 따른다. 운영 도구 범위가 아니다.

## 5. 플러그인

필수 플러그인(ecc, impeccable)은 setup이 설치한다. 마켓플레이스가 플러그인별 버전 고정을 지원하지 않아 늘 최신이 설치된다. `plugins.json`의 version은 최소 버전이고, doctor는 그보다 낮을 때만 주의를 띄운다.

아래는 `plugins.json`에서 required가 false인 선택 플러그인이다. 필요하면 설치한다. doctor는 없어도 통과로 본다.

- claude-mem: `claude plugin marketplace add thedotmack/claude-mem` 뒤 `claude plugin install claude-mem@thedotmack`
- prompts.chat: `claude plugin marketplace add f/prompts.chat` 뒤 `claude plugin install prompts.chat@prompts.chat`

## 6. 옮기지 않는 것

새 PC에서는 아래가 빈 상태로 시작한다.

- 승인 대기열(`~/.claude/wy-approvals/<namespace>/`): 런타임 상태라 옮기지 않는다.
- 세션 대화 기록(`~/.claude/projects/<프로젝트>/*.jsonl`): 활동 보기는 빈 기록에서 시작한다.
- 인수인계 파일(`~/.claude/session-data/`): 이 PC에만 남는다.
- 메모리 폴더: 저장소 경로가 다르면 폴더 이름도 달라져 새로 쌓인다. 기준 규칙은 CLAUDE.md와 docs에 있다.

## 7. 옮기기 전에 원래 PC에서 할 일

- [ ] 승인 센터의 대기 카드를 모두 처리한다.
- [ ] 역할 세션을 작업 경계에서 멈춘다. 이어 갈 내용은 docs와 커밋으로 넘기고 푸시한다.
- [ ] 비밀값 폴더를 위 3절 방법으로 옮긴다.

## 8. 이 PC 정리(한 번)

옛 승인 위치(`~/.claude/wy-approvals/` 바로 아래의 requests·decisions·used·decisions.log)와 옛 설치본(`~/.wy-tools/vscode-dashboard`)은 `install.ps1 cleanup-legacy`로 지운다. 이 명령은 목록을 보여 주고 확인(y)을 받은 뒤에만 지운다. 프로젝트별 승인 폴더는 건드리지 않고, 훅이 아직 옛 설치본을 가리키면 그 항목은 지우지 않는다.

# PC 이전 체크리스트 — 운영 도구 패키지 + wy-worklog(erp-project)

이 PC(원래 PC)에서 다른 PC(새 PC)로 패키지(agentTeamPackage)와 erp-project 작업을 옮길 때 위에서부터 차례로 체크한다. 범용 설명은 패키지 `NEW-PC.md`, 이 프로젝트만의 값은 `docs/운영도구_설치.md`에 있고, 이 문서는 그 둘을 한 줄 순서로 묶은 것이다. 비밀값·개인 주소는 적지 않는다.

조사 기준: 2026-10-09, 원래 PC(Windows 10 Home, 사용자 폴더 `C:\Users\ksoun`).

## A. 원래 PC — 옮기기 전 정리

- [ ] 승인 센터의 대기 카드를 모두 처리한다(P4 시작 카드 포함, 정하지 않을 거면 '나중에').
- [ ] pm에 "인수인계" 지시 → 역할 세션이 진행 중인 것을 저장하고 멈춘다(`session.ps1 prep`). pm도 `/ecc:save-session`(short-id `WY-pm`).
- [ ] erp-project 미커밋 정리(WY-commit 경유):
  - [ ] pm: `docs/진행현황.md`, `.claude/skills/pm-ops/SKILL.md`, `.claude/wy-ops.lock.json`, 이 문서
  - [ ] 다른 세션: `frontend/src/calendar/TaskPanel.tsx`·`taskPanel.module.css`(WY-frontend2), 루트 `api.py`(주인 확인)
- [ ] erp-project 푸시: 모든 브랜치의 커밋이 원격에 있는지 확인(`git status -sb`가 ahead 없음).
- [ ] **agentTeamPackage 푸시** — 지금 로컬 main이 원격보다 5커밋 앞섬(MANUAL·quickstart·멈춤 감지·effect·0.7.1). 푸시하지 않으면 새 PC가 0.7.0을 받는다. 공개 저장소라 사용자가 매뉴얼을 읽고 승인한 뒤 푸시한다.
- [ ] 이전 묶음 만들기: erp-project 폴더에서
  `"$env:USERPROFILE\.wy-tools\wy-ops\current\install.ps1" export --out <USB>\wy-transfer.zip`
  미커밋·미푸시가 남으면 경고가 뜬다. 묶음은 그 시점의 사본이다(동기화 아님).
- [ ] 묶음에 안 들어가는 것을 따로 챙긴다(아래 D·E): 비밀값 폴더, VS Code 설정·단축키, 글꼴, 브라우저 로그인.

## B. 새 PC — 기본 도구

- [ ] Windows 10 이상, Windows PowerShell 5.1, winget.
- [ ] Node.js LTS·Git·GitHub CLI·VS Code·Claude Code는 `install.ps1`이 확인하고 없으면 확인받고 설치한다. 직접 깔아도 된다. 원래 PC 버전: Node v24.12.0, Git 2.52, VS Code 1.141, Claude Code 2.1.29x, Python 3.14.2.
- [ ] 개발 도구(erp-project README '버전' 표): JDK 21(Gradle toolchain, JAVA_HOME은 17이어도 됨 — 원래 PC는 Zulu 17), Docker Desktop(원래 PC 29.8.1, PostgreSQL 18 로컬 compose).
  - JDK 21을 Gradle이 못 찾으면 `~/.gradle/gradle.properties`에 `org.gradle.java.installations.paths=<JDK 21 경로>`. 원래 PC에는 이 파일이 없다(자동 탐지로 됨).
- [ ] 가능하면 사용자 폴더·프로젝트 경로를 원래 PC와 같게: `C:\projects\erp-project`, `C:\projects\agentTeamPackage`, `C:\projects\worklog-secret`. 공백·한글 없는 경로여야 한다(doctor가 확인).

## C. 새 PC — 로그인

- [ ] `gh auth login` → `gh auth status`가 Logged in.
- [ ] git 사용자: `git config --global user.name tungasa200`, `user.email`은 원래 PC와 같은 주소. 원래 PC의 다른 전역 설정은 Git for Windows 기본값(autocrlf=true, credential.helper=manager)이라 따로 옮길 것 없음.
- [ ] Claude Code: 터미널에서 `claude` → `/login`.

## D. 새 PC — 패키지 설치와 묶음 복원

Claude Code 창·세션을 모두 끈 상태에서.

- [ ] `git clone https://github.com/tungasa200/agentTeamPackage C:\projects\agentTeamPackage`(A의 푸시 뒤).
- [ ] `powershell -ExecutionPolicy Bypass -File C:\projects\agentTeamPackage\install.ps1 restore <USB>\wy-transfer.zip`
  설치본·확장 → erp-project clone(묶음의 원격·브랜치) → 묶음 들여오기 → setup·doctor 순서. 끝에 남은 할 일을 출력한다.
- [ ] restore가 출력한 '다시 입력' 항목(MCP 토큰 등 자리표시)을 채운다. 원래 PC MCP 서버: `headroom`, `agent-browser`.
- [ ] erp-project 폴더에서 `claude`를 한 번 실행 → 'Do you trust the files in this folder?' Yes → `/exit`. 이게 없으면 역할 세션이 'Workspace not trusted'로 안 뜬다.
- [ ] 묶음 zip을 USB·새 PC에서 지운다.
- [ ] 비밀값 폴더 `C:\projects\worklog-secret\`를 암호화 USB·비밀번호 관리자로 직접 복사(메신저·메일·클라우드 금지).
- [ ] VS Code로 erp-project를 열고 `Developer: Reload Window` → 승인 센터 탭이 뜨는지 확인.
- [ ] `install.ps1 doctor`(설치본 `~/.wy-tools/wy-ops/current/install.ps1 doctor`) 전 항목 ok.

restore가 함께 옮기는 것: 프로젝트 메모리, 승인 이력, 인수인계 파일, `.claude/settings.local.json`, `~/.claude`의 CLAUDE.md·skills·agents·hooks·settings.json·settings.local.json, `~/.claude.json`의 MCP 서버. Claude Code 전역 설정(model opus, `tui: fullscreen`, 플러그인 4종과 마켓플레이스, autoMode 규칙)은 `~/.claude/settings.json`에 있으므로 묶음으로 넘어간다. 플러그인은 setup이 다시 설치한다(늘 최신).

## E. 새 PC — 터미널 설정 (원래 PC 조사 결과)

원래 PC는 Windows Terminal·PowerShell 프로필·oh-my-posh·Git Bash 개인 설정(.bashrc 등)을 쓰지 않는다. 터미널 설정은 **VS Code 통합 터미널 설정 + 단축키 + 글꼴**이 전부다.

- [ ] 글꼴 **Sarasa Mono K**(Regular·Bold·Italic·BoldItalic) 설치. 원래 PC는 사용자 글꼴(`%LOCALAPPDATA%\Microsoft\Windows\Fonts\SarasaMonoK-*.ttf`)로 깔려 있다. 이 4개 파일을 복사해 '모든 사용자용으로 설치'하거나 배포처(be5invis/Sarasa-Gothic 릴리스)에서 받는다. 설정에 적힌 다음 후보 `D2Coding`은 원래 PC에도 없다(없어도 됨).
- [ ] VS Code 사용자 설정 옮기기 — Settings Sync를 켜거나(원래 PC는 꺼져 있음), `%APPDATA%\Code\User\settings.json`에 아래 터미널 부분을 넣는다.

  ```json
  "claudeCode.preferredLocation": "panel",
  "terminal.integrated.mouseWheelScrollSensitivity": 3,
  "terminal.integrated.fontFamily": "'Sarasa Mono K', 'D2Coding', monospace",
  "terminal.integrated.fontSize": 14,
  "terminal.integrated.lineHeight": 1.35,
  "terminal.integrated.letterSpacing": 0.3,
  "terminal.integrated.gpuAcceleration": "on",
  "terminal.integrated.minimumContrastRatio": 4.5,
  "terminal.integrated.smoothScrolling": true,
  "terminal.integrated.scrollback": 10000,
  "terminal.integrated.cursorStyle": "line",
  "workbench.colorCustomizations": { "terminal.background": "#252526" },
  "workbench.colorTheme": "Visual Studio Dark - C++",
  "workbench.iconTheme": "vscode-icons"
  ```
  원래 PC의 `jdk.jdkhome`(`c:\works\CampingLounge\oracleJdk-21`)는 다른 프로젝트 경로라 옮기지 않는다. 새 PC JDK 21 경로로 바꾸거나 뺀다.
- [ ] VS Code 단축키 `%APPDATA%\Code\User\keybindings.json` — 터미널에서 Shift+Enter로 줄바꿈(Claude Code 여러 줄 입력):

  ```json
  [ { "key": "shift+enter", "command": "workbench.action.terminal.sendSequence",
      "args": { "text": "\u001b\r" }, "when": "terminalFocus" } ]
  ```
  Claude Code에서 `/terminal-setup`을 실행해도 같은 줄이 들어간다.
- [ ] VS Code 확장(테마 `Visual Studio Dark - C++`는 `ms-vscode.cpptools-themes`, 아이콘은 `vscode-icons-team.vscode-icons`). 원래 PC 목록은 `code --list-extensions`로 뽑아 새 PC에서 `code --install-extension <id>`. 업무에 쓰는 것: anthropic.claude-code, ms-ceintl.vscode-language-pack-ko, redhat.java, vscjava.vscode-gradle·java-debug, vmware.vscode-spring-boot, dbaeumer.vscode-eslint, esbenp.prettier-vscode, ms-vscode.powershell, usernamehw.errorlens. `wy-ops.wy-ops`는 restore가 설치한다.
- [ ] 코드 페이지: 원래 PC는 시스템 기본(949)이고 따로 바꾸지 않았다. 새 PC도 기본 그대로 둔다(Claude Code·도구가 UTF-8을 직접 맞춤).

## F. 새 PC — 역할별 외부 준비

- [ ] WY-browser: 전용 Chrome 프로필 바로 가기
  `chrome.exe --user-data-dir="%USERPROFILE%\.agent-browser\erp-chrome" --remote-debugging-port=9222 --no-first-run`
  그 창에서 GitHub·Railway·Vercel(팀 tungasa200s-projects)·가비아에 사람이 로그인. 프로필은 옮기지 않고 새로 로그인한다.
- [ ] WY-qa·WY-qa2: agent-browser는 setup이 설치. 자기 세션 이름으로 따로 띄운다.
- [ ] 메모리 8GB PC라면 원래 PC와 같은 규칙(무거운 작업 전 여유 메모리 500MB 확인).

## G. 새 PC — 작업 이어가기

- [ ] VS Code 터미널에서 pm 시작: `session.ps1 pm-cmd`가 원래 PC에서 출력한 줄(또는 `claude --name WY-pm` 후 `/ecc:resume-session <저장 파일>`).
- [ ] pm이 `session.ps1 start WY-commit` → `pin WY-commit`, 나머지 역할은 필요할 때.
- [ ] 승인 센터 알림 소리 확인(tmp 카드 한 장).
- [ ] 원래 PC에서 이 프로젝트를 더 쓰지 않으면 그쪽 역할 세션을 모두 멈춘다. 두 PC에서 같은 브랜치를 동시에 고치지 않는다.

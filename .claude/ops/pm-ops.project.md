## 프로젝트 부록 (erp-project, 제품명 WY)

위 절차에 더해 이 프로젝트에서만 지키는 것. 위와 다르면 이 부록을 따른다.

### 0. 늘 지키는 것
- **사용자에게 하는 말, 승인 센터 choice 요청, AskUserQuestion, 다른 세션에 보내는 메시지는 모두 한국어로 쓴다.** 다른 세션이 영어로 보고해도 pm은 한국어로 정리한다. 사용자가 명시적으로 요구한 규칙이다.
- 역할 세션: WY-backend1·WY-backend2·WY-frontend·WY-frontend2·WY-design·WY-planner·WY-qa·WY-browser·WY-commit(·WY-search). 이름이 역할과 다른 세션(`erp-project-xx` 등)은 짐작해서 보내지 않는다.
- 비밀값과 운영 테스트 계정은 `C:\projects\worklog-secret\secret.txt`에만 있다(테스트 계정은 2026-10-09 추가, 운영 로그인 확인은 여기서 꺼내 씀). 읽을 수는 있지만 값을 메시지·문서·메모리에 옮기지 않는다.

### 1. 작업 지시
- 작업 ID는 WBS ID(예: P1-03), 근거는 요구사항 ID, 화면 ID, 결정 D-nn, 계약 커밋.
- 경계 예: Flyway 번호, 계약 yaml 편집 순서를 다른 세션과 맞춘다.
- 화면 작업이면 디자인 점검 단계를 넣는다 — WY-frontend·WY-frontend2에는 "화면을 다 만들면 커밋 요청 전에 바뀐 화면에 `/impeccable harden`을 돌리고 고친 점을 [완료]에 적기"를, WY-design에는 단계 끝 발행 전에 "구현된 화면에 `/impeccable audit`"을 넣는다. impeccable은 직접 불러야 쓰이는 스킬이라, 지시문에 없으면 아무도 쓰지 않는다(P1 초반에 실제로 그랬고, qa가 같은 유형의 접근성 결함 — 44px 미만, 닫을 때 포커스 유실 — 을 반복해서 찾았다).

### 2. 보고 처리
- [완료] 확인: `git log --oneline origin/<브랜치>`, `gh run view`/`gh run list`(PR CI). 화면 변경이면 WY-qa 실행을, API 스냅샷이 바뀌었으면 WY-frontend의 생성 타입 갱신이 같은 푸시에 들어가는지를 챙긴다. 진행현황은 WBS 줄을 갱신한다.
- [결정 요청] '사용자에게 올린다'의 API 계약은 필드 의미가 바뀌는 것, '문서와 다른 동작'은 요구사항·화면정의서와 다른 동작. 'pm이 정하고 즉시 알린다'(정한 순간 "[pm 결정]" 한 줄 보고, 애매하면 카드, 승인된 순서는 세션끼리 바로 잇기)는 2026-10-07 사용자 확정. 그 예: 화면정의서에 있는 표시를 위한 응답 필드 추가, 문서에 "P2에서 추가"처럼 단계가 적혀 있는 것, 접근성·디자인 세부(WY-design 기준). 판단이 틀렸던 사례가 있었다(원인을 잘못 짚음).
- 결정이 나면: 영향받는 세션 예는 WY-frontend·WY-qa·WY-design. 결정 기록은 WY-planner에 요청(D-nn, 결정·근거·대안·관련 ID). 문서 본문 수정은 `docs/개정대기.md`·`docs/개정대기_화면정의서.md`에 올리고 단계 끝에 일괄 개정한다(D-54). WY-planner가 꺼져 있으면 진행현황 "결정기록 대기"에 적는다.
- [차단] 사용자 행동 예: "자동화 Chrome에서 Railway 다시 로그인".
- [결함](WY-qa): TC ID로 넘긴다. 접근성·시각 결함이면 수정 뒤 `/impeccable harden`으로 같은 화면의 비슷한 문제를 함께 훑게 한다. 반복 유형 예: 터치 영역 44px, 닫을 때 포커스 복귀.

### 3. 메모리
- 8GB PC에서는 세션 9~10개와 VS Code만으로 여유가 1GB 아래로 떨어진다(16GB PC에서는 대부분 생략 가능).
- 무거운 작업 예: gradle 빌드, vitest·tsc 전체, vite 개발 서버, 브라우저 자동화, WY-commit 사본 검증. 세션이 뜰 때 순간 약 700MB를 쓴다.
- 기준은 사용자 지시 2026-10-07(500MB가 막는 선, 1GB는 안전 여유, 병렬·효율 우선).
- 여러 frontend 묶음이 겹치면 작업 세션은 tsc·lint·바뀐 테스트 파일만 돌리고(동시 가능), 전체 vitest는 WY-commit이 묶음을 한 사본에 합쳐 한 번만 돌린다(2026-10-06 사용자 승인). WY-qa(개발 서버+브라우저 ~600MB)와 테스트(~400MB)를 동시에 돌리지 않는다.
- 계속 모자라면 제안: Docker 끄기(→ backend는 컴파일만, 테스트와 스냅샷은 PR CI), VS Code 탭·Java 확장 정리.

### 4. 커밋 묶음
- API 스냅샷(`contracts/generated/*.json`)이 바뀐 백엔드 커밋은 frontend 생성 타입 커밋과 **같은 푸시**에 들어가야 CI 타입 일치 검사를 통과한다. 백엔드 세션이 커밋 요청할 때 WY-frontend에 gen:api를 알리게 한다.
- 코드 커밋 전체 검증은 PR CI.

### 6-1. 세션
- `claude attach`로 깨운 세션이 `--agent` 없이 뜬 사례: 2026-10-07 WY-commit이 이렇게 떠서 가드 훅에 커밋이 막혔다.
- 재사용 정책의 근거(실측 2026-10-07): 90분 캐시 읽기 2억 900만 토큰 중 96%가 대화 80만 넘게 자란 Opus 세션 4개에서 나왔다. 사용자 기준은 "자주 껐다 켜기보다 대기로 두고(메모리를 좀 더 써도 됨) 토큰을 덜 쓴다". claude-mem 제거는 보류.
- WY-commit은 백그라운드로 두고 고정(pin)한다(사용자 결정 2026-10-07, 카드 20261007-1640). 데몬은 메모리가 부족하면 고정 안 된 쉬는 세션부터 정리한다(daemon.log의 `bg retire ... [low memory]`). 고정 목록 `~/.claude/jobs/pins.json`은 세션이 쓰면 권한 분류기가 막으므로, 교대 때마다 pm이 사용자에게 고정 할 일 카드(`claude.cmd agents` → 고정 키)를 올린다.
- 고정은 `session.ps1 pin WY-commit`으로 한다(사용자 결정 2026-10-07, 카드 20261007-1700: 사용자 허용 규칙으로 이 명령만 연다). WY-commit을 띄우거나(start) 교대한(rotate) 뒤 바로 부른다. start·rotate는 스스로 고정하지 않는다. 데몬의 정리 시작선은 여유 메모리 약 1GB라, pm은 여유가 1GB 아래로 내려가면 일을 마친 세션부터 stop한다.

### 6-2. 터미널(이 PC, 2026-10-07)
- 계기: 메모리 절감을 위해 WY-pm을 패널 대신 터미널로 옮겼다. 긴 pm 패널을 닫자 VS Code가 약 3.5GB에서 1.4GB로 줄었다.
- 터미널 글꼴: Sarasa Mono K(사용자 글꼴 폴더에 설치, 한글·영문 폭 2:1), 대체 글꼴 D2Coding. 크기 14, 줄 간격 1.35, 커서 line, scrollback 10000.
- `terminal.integrated.gpuAcceleration`은 "on"이다. `/terminal-setup`은 글자 깨짐을 막으려고 "off"로 바꾸는데, 사용자 선택으로 다시 켰다. 깨짐·깜빡임이 생기면 "off"로 되돌린다.
- 기본 실행 정책에서는 npm의 claude.ps1이 막혀서, 스크립트와 안내 명령은 `claude.cmd`로 부른다.

### 7. 단계 마무리 (P1 끝 등)
- PR(feature/P<n> → main)은 merge commit으로 병합(WY-commit, 사용자 승인).
- 병합 직전 WY-browser로 운영 변수 이름 확인, 병합 직후 WY-qa로 운영 확인(진행현황 "다음 작업"의 병합 직후 항목).
- 일괄 개정은 WY-planner(요구사항정의서·작업계획서)와 WY-design(화면정의서).

# AI 티 나는 디자인 필터 — 초안 v0 (2026-10-12, WY-search)

## 0. 범위와 출처
- 대상: worklog 화면(React + CSS Modules, 토큰 frontend/src/theme/tokens.css, 생산성 도구 = impeccable의 Operate 모드). 랜딩(src/landing/)은 Persuade 모드라 랜딩 전용 항목을 따로 표시.
- 수집: agent-reach 1.5.0. doctor 결과 B站만 ok, GitHub warn(gh 실행 가능), Reddit·X·YouTube·Facebook·Instagram·小红书 off. 사용자 결정(카드 0310)으로 로그인·키가 필요한 채널(Exa·Reddit·X)은 안 씀. 쓴 것: 웹 검색 + Jina Reader(웹 읽기) + HN Algolia 공개 API + V2EX 공개 API + gh(읽기).
- 출처: 영어권 32곳(블로그·Substack·HN·GitHub 이슈·Reddit 3,033댓글 집계 데이터셋 S21), 한국어·중국어·GitHub 29곳(K·C·G·E). 두 묶음 사이 중복 4곳(prg.sh, anthropics/skills#1959, altera#4, vibecoded-design-tells). 빈도는 '언급한 서로 다른 출처 수'이고, 번역·재인용 글이 섞여 있어 독립 관찰 수보다 크다.
- 빠진 범위: Reddit 직접 읽기(403 차단, S21 인용으로만), X(직접 0건, 2차 인용만), B站(검색 API가 캡차 반환), wikidocs(캡차, 검색 요약만), Dribbble·Behance·NN/g·Smashing·uxdesign.cc(관련 글 못 찾음), Threads·디스콰이엇·커리어리·요즘IT·네이버 블로그(관련 글 없음). 한국어 원글 목소리는 5곳뿐(K1 K2 K7 K8 K9), 나머지 한국어는 영어 글 번역.
- impeccable 기준: 설치본 4.5.2 SKILL.md·reference/*.md와 감지 도구(impeccable.exe 0.1.14 내장 규칙, 'DET')에서 피하라는 패턴 50개 추출.

## 1. 판정 공통 규칙
- 기계 판정: (a) 소스 grep(CSS Modules·tsx), (b) 실행 화면의 getComputedStyle 집계(값 종류 수, 반복 비율), (c) `impeccable detect --json <파일>`(DET 규칙). 눈 판정: 화면 캡처를 '이 화면을 다른 제품에 그대로 써도 되나'(impeccable critique 첫 질문)로 본다.
- 예외: 값이 tokens.css나 화면정의서 2장에 정의돼 있으면 '의도됨'으로 판정하지 않는다. 다만 토큰 자체가 패턴과 겹치면 §4 '토큰 재검토 목록'에 올려 WY-design이 판단한다.
- 기능적 사용은 제외: 로딩 스켈레톤 pulse, 시간축 눈금선처럼 정보·상태를 전하는 것.
- 아래 수치 기준 중 '(제안)'은 출처에 없는 이번 초안의 제안값.

## 2. 필터 표
출처 칸: 조사 = 영어 n / 한·중·GH n, imp = impeccable(AI 티로 명시 'AI', 일반 품질 규칙 'Q').

| ID | 이름 | 왜 AI 티인가 | 출처 | 판정 방법 | 예외 | 대체 방향 | 이 앱 현황 |
|---|---|---|---|---|---|---|---|
| AIT-01 | AI 보라·남색, 보라→파랑 그라데이션 | Tailwind 기본 indigo-500에서 굳은 생성 기본값. 가장 많이 언급됨 | 조사 17/18 · imp AI(DET ai-color-palette) | 기계: 강조색 hue가 남색~보라(OKLCH h 약 265–300) 여부, linear/radial-gradient 개수 | 사용자 설정 키 컬러 | 그라데이션 없이 단색, 강조색은 주 버튼·선택·상태에만 | 그라데이션 1건(시간축 눈금, 기능). 기본 키 컬러 #4b3fd6이 이 대역 → §4 |
| AIT-02 | 그라데이션 글자 | 제목·지표에 background-clip:text | 조사 5/≥1 · imp AI | 기계: background-clip:text 개수 = 0 | 없음 | 굵기·크기로 강조 | 0건 |
| AIT-03 | 기본 글꼴 하나로 전부 (Inter·Roboto·Geist·Space Grotesk) | 생성물이 같은 몇 개 글꼴로 수렴 | 조사 14/8 · imp AI(DET overused-font) | 기계: 계산된 font-family 목록 | 한국어 본문 Pretendard(화면정의서). Operate는 '시스템·실무용 글꼴이면 충분'(imp) | 숫자·라벨용 Inter 추가 금지, 숫자는 tabular-nums | font-family 6곳. Pretendard는 Inter 기반(추론) → §4 참고만 |
| AIT-04 | 이탤릭 세리프 제목, 제목 속 기울인 강조 단어 | 2026년 'Claude식' 새 기본값. 한·중 글자에서 더 어색(C4) | 조사 0/6 · imp AI(DET) | 기계: h1·h2 font-style:italic, serif 계열 | 없음 | 쓰지 않음 | 확인 필요(이탤릭 grep 안 함) |
| AIT-05 | 크림·베이지 바탕 + 세리프 + 테라코타 ('덜 AI처럼' 요청 뒤 나오는 2세대 기본값) | Opus 세대 기본값으로 지목 | 조사 6/2 · imp AI | 기계: 바탕색 명도·hue(#F4F1EA 부근), 강조 #D97757 부근 | 없음 | 해당 없음 유지 | 바탕 #f2f4fa(청회색) → 해당 없음 |
| AIT-06 | 모든 걸 카드로, 카드 안 카드 | '카드는 게으른 그릇'(imp). 표·목록이 맞을 곳까지 상자 | 조사 9/4 · imp AI | 기계: 배경+모서리+그림자/테두리를 가진 요소가 2단 이상 중첩된 수, 섹션 중 카드 비율(제안 50% 이하) / 눈 | 화면정의서가 카드로 정한 영역 | 먼저 간격으로 묶고, 목록은 행, 비교는 표 | 미측정(실화면 집계 필요) |
| AIT-07 | 같은 크기 카드 격자(아이콘+제목+글) | '범용 AI 기능 카드 틀' | 조사 11/7 · imp AI | 기계: 형제 카드 3개 이상의 크기·구조 동일 / 눈 | 실제 같은 종류 데이터 목록 | 내용 길이·중요도에 따라 크기·배치 다르게 | 랜딩 위주로 확인 |
| AIT-08 | 한쪽 굵은 색 띠(border-left 3–4px, ::before 막대) | 'AI UI의 em dash', imp가 '가장 알아보기 쉬운 티' | 조사 6/4 · imp AI(DET side-tab, craft-floor 1px 초과 금지) | 기계: border-left/right ≥2px 색, inset box-shadow 띠, ::before 막대 | 상태를 뜻하는 띠는 화면정의서에 있을 때만 | 상태는 아이콘·글자·배경 tint로 | border-left 2px 이상 0건(::before·inset 띠는 미확인) |
| AIT-09 | 값이 제각각(글자 크기·모서리·그림자 드리프트) | 생성 때마다 즉석 값을 넣어 체계가 없음(S5: 글자 11종·모서리 8종) | 조사 6 · imp Q(DET 'DESIGN.md 밖 값', audit Theming 하드코딩) | 기계: 고유값 수. (제안) font-size ≤8종, radius ≤5종, box-shadow ≤4단계, tokens.css 밖 hex 0 | 없음 | 크기·모서리·그림자를 토큰 단계로 묶고 var()만 쓰기 | **가장 큰 해당**: radius 38종, font-size 28종(12.5·13.5px 등 반 픽셀 포함), box-shadow 25종, tokens.css 밖 hex 164건 |
| AIT-10 | 하나의 큰 모서리를 전부에, 알약 남발 | '손톱 같은 카드', 모든 게 둥긂 | 조사 ?/7 · imp(DET 둥근 요소+굵은 테두리) | 기계: radius ≥16px 비율, pill 사용처 수 | 토큰 --radius-card 20px·pill | 요소 크기에 맞춘 2–3단계 모서리 | 22px 57곳 등 큰 모서리 많음 → §4 |
| AIT-11 | 평평한 위계 | 모든 패널이 같은 테두리·배경·대비라 눈이 갈 곳이 없음 | 조사 6 · imp Q(DET 단계 비율 1.25 미만) | 기계: 제목/본문 크기 비율 / 눈: 흐리게 봤을 때 1순위 1개, 2순위 2–3개 | Operate는 1.125–1.2 비율 권장(imp 내부 충돌, DET 경고는 참고) | 크기·굵기·간격으로 위계 | 미측정 |
| AIT-12 | 단조로운 간격 | 같은 간격 값만 반복 | 조사 3 · imp AI(DET) | 기계: margin/gap/padding 값 분포, 최빈값 비율(제안 40% 이하) | 없음 | 묶음 안은 촘촘히, 묶음 사이는 넉넉히 | 미측정 |
| AIT-13 | 아이브로우·대문자 자간 라벨·01/02/03 번호 | 제목 위 작은 라벨은 'AI SaaS 히어로 기본값', imp는 '금지' | 조사 5/5 · imp AI | 기계: text-transform:uppercase, 제목 바로 위 작은 글자 요소, 0n 번호 | 순서가 정보일 때 번호 | 제목만으로 | uppercase 0건. letter-spacing 24곳은 값 확인 필요 |
| AIT-14 | 장식용 상태 점·가짜 Live/연결됨 배지·깜빡임 | 아무 정보도 없는 '살아 있음' 신호 | 조사 5/6 · imp AI(DET) | 기계: 무한 반복 animation, 'Live/Active' 배지 / 눈: 실제 상태와 연결됐나 | 로딩 스켈레톤, 실제 진행 중 기록 | 실제 상태일 때만, 움직임 없이 | pulse 1건 = Skeleton(기능, 예외) |
| AIT-15 | 이모지를 아이콘으로 | 아이콘 세트 대신 이모지 | 조사 7/6 · imp AI | 기계: tsx 문자열의 이모지 범위 | 사용자가 입력한 글 | 한 가지 선 굵기의 SVG 아이콘 세트 | 미측정(grep 실패, 다시 확인 필요) |
| AIT-16 | 다크+네온 글로우, 색 번진 그림자, 히어로 뒤 원형 후광 | '멋져 보이려는' AI 기본값 | 조사 7/4 · imp AI(DET 0 오프셋 색 그림자) | 기계: box-shadow 색이 무채색이 아님, offset 0 + 큰 blur, radial-gradient | 없음 | 그림자는 오프셋 있고 무채색에 가깝게 | --shadow-accent(키 컬러 30%, 오프셋 6px) 3곳 → §4 |
| AIT-17 | 글래스모피즘(backdrop-filter 장식) | 장식용 흐림 | 조사 6/2(Reddit 집계에선 약함) · imp AI | 기계: backdrop-filter | 시트 뒤 가림막처럼 기능일 때 | 불투명 표면 | 0건 |
| AIT-18 | 의미 없는 여러 강조색 | 항목 '구분용' 무지개색, 위계 없는 네온 | 조사 3/5 · imp Q(distill: 색 1–2+무채색, Operate: 강조는 주 동작·선택·상태만) | 기계: 한 화면 고채도 hue 수 / 눈 | 프로젝트 색 P1–P8(데이터 식별색) | 색은 데이터·상태에만 | P1–P8은 예외. 장식에 쓰인 곳 있는지 눈 확인 |
| AIT-19 | 낮은 대비(회색 위 회색, 어두운 테마 흐린 글자) | AA 미달 다크 테마 | 조사 5 · imp Q(4.5:1, 큰 글자·컨트롤 3:1, '색 위 회색 금지') | 기계: 대비 계산 | 없음 | 표면 hue로 물든 글자색 | harden에서 점검 중 |
| AIT-20 | 큰 숫자 지표 타일(히어로 지표 틀) | '큰 숫자·작은 라벨·보조 수치·강조' 틀, 같은 수 반복 | 조사 4 · imp AI | 눈: 같은 수가 두 번 이상 나오나, 결정에 쓰이나 | 통계 화면 핵심 수치 1–2개 | 수치는 맥락(기간·비교)과 함께, 타일 남발 금지 | 통계 화면(src/stats) 눈 확인 |
| AIT-21 | 모션 과다, 모든 섹션 페이드인, 튕기는 easing | 생성물의 기본 애니메이션 | 조사 3/5 · imp AI/Q(bounce 금지, Operate 150–250ms 상태 변화만) | 기계: animation/transition 수, cubic-bezier 값, reduced-motion 대응 | 없음 | 상태 변화에만 짧게 | 미측정 |
| AIT-22 | 상태 누락(hover·focus·disabled·error·loading) | 생성물은 기본 상태만 만듦 | 조사 3 · imp Q | 기계: 컨트롤별 :hover/:focus-visible/:disabled 규칙 존재 | 없음 | 모든 컨트롤 8개 상태 | harden에서 점검 중 |
| AIT-23 | 과장 카피·버즈워드, 대시보드가 랜딩처럼 말함 | 'Seamless·Elevate·Transform your X' | 조사 4 · imp AI(DET 버즈워드) | 기계: 금지어 목록 grep(한국어판 제안: 혁신적인·손쉽게·완벽한·스마트한) | 없음 | 무엇을 하는지 동사로 | 미측정 |
| AIT-24 | 장식 기호(em dash 남발, // 머리 장식) | 'AI 말투 티' | 조사 5 · imp AI(DET em dash 500자당 1개 이상) | 기계: UI 문자열의 '—' 수 | 없음 | 쉼표·마침표 | 미측정 |
| AIT-25 | 모노스페이스를 '기술 느낌' 의상으로 | 메타 라벨 mono | 조사 3 · imp AI | 기계: monospace 사용처 | 코드·시간 같은 측정값 | 숫자는 tabular-nums로 | font-family 6곳 확인 |
| AIT-26 | 카드마다 얇은 테두리 + 넓게 퍼진 그림자 | 생성 UI 서명 | 조사 2 · imp AI(DET) | 기계: border 1px + blur ≥24px 같이 쓴 요소 수 | 떠 있는 시트·팝오버 | 둘 중 하나만 | blur 44·60px 그림자 있음, 테두리 동반 여부 확인 |
| AIT-27 | 경쟁하는 CTA 3개 이상 | 무엇을 누를지 모름 | 조사 1(K1) · imp Q(주 1 + 보조 1–2) | 기계: 한 화면 주 버튼 스타일 수 | 없음 | 주 동작 하나 | 미측정 |

## 3. 한쪽에만 있는 것
조사에만 있음 (impeccable에 없음):
- AIT-28 shadcn·lucide·Tailwind 기본 테마 그대로(조사 6/3, Reddit 집계 1위 구체 항목). 판정: package.json 의존성과 기본 CSS 변수. 이 앱은 CSS Modules라 해당 가능성 낮음.
- AIT-29 개발자용 문구가 화면에 새어 나옴(조사 2, 번역 글). 판정: 눈 + 개발 용어 grep.
- AIT-30 순수 #000/#fff(1곳, 약함). 이 앱 글자색 #1a1c2b → 해당 없음.
- AIT-31 템플릿 섹션 순서(기능→가격→후기→CTA, 로고 바, 1-2-3 단계)(조사 6). 랜딩 전용.
- '여백 과다'(R1 상위 댓글) — 단일 출처, 기준 불명확해 보류.
- Pretendard 남용·한국어 UI의 영어 아이브로우·word-break 문제를 AI 티로 꼽은 출처는 못 찾음.
impeccable에만 있음 (조사에 없음):
- 장식용 격자선·반복 줄무늬 배경(DET) — 이 앱 시간축 눈금은 기능이라 예외.
- 반사적 모달(craft-floor, operate '모달은 대개 게으름').
- 브라우저 기본 표면 미처리: 선택색·캐럿·스크롤바·포커스 링·밑줄 간격·tabular-nums('모델이 가장 자주 빠뜨림').
- 하드 오프셋 그림자 4px 4px 0, 장식용 스파크라인·진행 링, 도형 조립 SVG 일러스트, organic clip-path, 카테고리로 정한 라이트/다크, 과대 히어로 제목·좁은 자간(-0.04em 하한), 'Yes/No/OK/Submit' 확인 버튼·자리표시자를 라벨로 쓰기.
- 품질 규칙(AI 티는 아님, harden·audit 몫): 대비, 줄 길이 65–75자, 줄 간격 1.5–1.7, 최소 글자 12–14px, 터치 44px, 표 120자 허용(Operate).

## 4. 토큰 재검토 목록 (예외지만 패턴과 겹침, WY-design 판단)
1. --color-accent 기본값 #4b3fd6: AIT-01 대역. 사용자가 바꿀 수 있는 값이라 기본값만의 문제. 그라데이션을 안 쓰니 위험은 중간.
2. --shadow-accent(키 컬러 30% 그림자): AIT-16 '색 그림자'와 겹침. 오프셋 6px이라 imp의 '0 오프셋 글로우' 정의엔 안 걸림.
3. --radius-card 20px·pill + 실제 22·26px 다수: AIT-10.
4. Pretendard: Inter 기반이라 AIT-03과 계열이 같음(추론). 한국어 대안이 적어 유지가 현실적.
5. 토큰 밖 값(AIT-09): radius 38종·font-size 28종·shadow 25종·hex 164건. 필터 첫 적용 대상으로 추천.

## 5. 적용 순서 제안
1) 기계 판정 스크립트(grep + 실화면 집계)로 AIT-09·08·02·13·15·17·24 먼저 → 2) `impeccable detect`로 DET 규칙 대조 → 3) 눈 판정(AIT-06·07·11·20·27)은 WY-design 감사(/impeccable audit)에 체크리스트로 붙임 → 4) 출시(REL) 중에는 측정·기록만 하고 수정은 다음 단계 권장.

## 6. 주요 출처
영어: S1 adriankrebs.ch/blog/design-slop (2026-04-20, Show HN 1,590쪽 측정) · S2 news.ycombinator.com/item?id=47864393 (2026-04-22) · S4 HN 46956964 (2026-02-10) · S5 kucharski.substack.com/p/ten-reasons-your-vibe-coded-dashboard (2026-09-02) · S6 pages.thefountaininstitute.com/posts/7-tells-that-a-ui-is-ai-generated · S7 impeccable.style/slop · S8 prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website (2025-10-26) · S11 tailthemes.com/blog/ai-design-slop-quality-gate (2026-08-20) · S15 claude.com/blog/improving-frontend-design-through-skills (2025-11-12) · S19 capitalandcompute.net/blog/fix-ai-slop-design (2026-09-25) · S21 github.com/JCarterJohnson/vibecoded-design-tells (Reddit 3,033댓글 집계) · S22 github.com/anthropics/skills/issues/1959 (2026-10-03) · S23 github.com/ncolesummers/loopworks/issues/84 (2026-07-10)
한·중·GH: K1 ice-ice-bear.github.io/ko/posts/2026-04-15-vibe-coding-design · K2 tilnote.io/pages/6a9355cface8bd2da70ebf6a (2026-08-30) · K3 news.hada.io/topic?id=34370 (2026-09-28) · K4 news.hada.io/topic?id=32566 (2026-08-17) · C1 v2ex.com/t/1202989 (2026-04-02) · C2 v2ex.com/t/1193683 (2026-02-24) · C4 traeai.com 기사(@mitchellh 인용, 2026-05-26) · G2 github.com/pbakaus/impeccable/issues/112 · G4 pbakaus/impeccable/issues/394 · G10 github.com/Nutlope/hallmark/issues/74
전체 출처 61곳 목록(ID·날짜·요지)은 요청하면 보냄.

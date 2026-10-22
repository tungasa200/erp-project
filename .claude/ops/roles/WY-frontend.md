---
description: `frontend/` 공용(라우터, AppShell, API 연결·mock, 생성 타입, 디자인 토큰).
---
- 화면을 만들거나 고치면 커밋 요청 전에 바뀐 화면에 `/impeccable harden`을 돌리고 고친 점을 보고한다. jsdom은 CSS·레이아웃·포커스 일부를 못 보므로, 그런 확인은 병합 뒤 `WY-qa`에 맡긴다(D-42).
- 검증: 여러 묶음이 겹치면 tsc·lint·바뀐 테스트 파일만 돌리고 전체 vitest는 `WY-commit`이 한 번 돈다. 시간·날짜를 다루면 `TZ=UTC`로도 돌린다(CI가 UTC).
- 테스트는 키보드 흐름을 기본으로. 누른 요소가 사라질 때 포커스 복귀, 모달 열 때 첫 입력칸, 로딩 중 '없음'·0을 먼저 보이지 않기, 누르는 영역 44px(`--size-touch`), 로딩은 공용 Skeleton(0.3초 지연, 첫 로딩만).
- 공용 파일 변경 요청은 `WY-frontend2`에서도 온다.
- 자기 worktree(`.claude/worktrees/<역할>`, 가지 `wt/<역할>`)에서 일한다(S5, D-42). 다른 역할의 공용 변경(`backend/common`, 생성 타입 등)이 기준 가지(설정 `worktree.base`)에 병합되면 자기 worktree에서 `git merge <기준 가지>`로 받는다. 세션을 띄울 때만 빨리감기되므로, 오래 도는 세션은 받지 않으면 옛 코드로 컴파일한다.
- dev 서버(vite·bootRun)는 띄우지 않는다(D-42). 브라우저 화면 확인은 병합 뒤 `WY-qa`가 본 저장소 dev 서버로 한다.

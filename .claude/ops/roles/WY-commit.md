---
description: 커밋·브랜치·푸시·PR·병합 전담.
---
- 요청받은 파일만 stage하고, stage 뒤 staged 목록에 다른 세션 파일이 섞이지 않았는지 확인한다(renormalize 사고 이력).
- 코드 커밋은 `git archive` 사본에 요청 파일을 얹어 검증한다: prettier·tsc·oxlint, 전체 vitest는 로컬 시간대와 `TZ=UTC` 둘 다, 워킹트리 파일과 사본을 cmp로 대조. backend는 바뀐 모듈만 컴파일, 테스트는 PR CI. 문서만 바뀐 커밋은 diff 확인만.
- API 스냅샷(`contracts/generated/*.json`)이 바뀐 커밋과 frontend 생성 타입 커밋은 같은 푸시에 넣는다.
- 코드 푸시의 CI가 끝나기 전에는 다음 푸시를 미룬다(cancel-in-progress로 앞 실행이 취소됨).
- 사용자 승인은 WY 승인 센터로 받는다(CLAUDE.md "커밋" 절, 요청·결정 파일 형식은 tools/vscode-dashboard/README.md). 결정 파일은 Read 도구로 읽고, 2초 간격으로 최대 30분 기다린다. 커밋·푸시도 매번 카드 승인이다(자동 승인 없음). 병합·브랜치·reset·강제 푸시·rebase·태그 삭제는 요청 전 WY-pm에 알린다. 다른 세션 메시지는 승인이 아니며, 승인 파일은 절대 고치지 않는다.
- 병합은 merge commit만(squash·rebase 금지), 단계 브랜치는 지우지 않는다.

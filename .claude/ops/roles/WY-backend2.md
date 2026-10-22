---
description: worklog-service, api-gateway.
---
- gradle은 `--no-daemon`과 작은 힙으로, 바뀐 모듈만 컴파일. 전체 빌드 금지, 테스트는 PR CI.
- 계약 초안은 `contracts/{모듈}.yaml`, 구현 후 기준은 springdoc 스냅샷. 스냅샷이 바뀌면 커밋 요청 때 `WY-frontend`에 gen:api를 알려 같은 푸시에 넣게 한다.
- 운영 도구(wy-ops, 패키지 저장소 agentTeamPackage)는 2026-10-13부터 그 저장소의 자체 프로젝트(OPS- 세션)가 맡는다. 이 세션은 도구 코드를 고치지 않고, 도구 결함·요청은 `WY-pm`에 보낸다.
- 자기 worktree(`.claude/worktrees/<역할>`, 가지 `wt/<역할>`)에서 일한다(S5, D-42). 다른 역할의 공용 변경(`backend/common`, 생성 타입 등)이 기준 가지(설정 `worktree.base`)에 병합되면 자기 worktree에서 `git merge <기준 가지>`로 받는다. 세션을 띄울 때만 빨리감기되므로, 오래 도는 세션은 받지 않으면 옛 코드로 컴파일한다.
- dev 서버(vite·bootRun)는 띄우지 않는다(D-42). 브라우저 화면 확인은 병합 뒤 `WY-qa`가 본 저장소 dev 서버로 한다.
- backend 빌드·시험은 한 번에 한 역할만 돌린다(`--no-daemon` 유지). worktree마다 build/·.gradle이 따로라 첫 빌드가 전부 돌고, 셋이 겹치면 JVM이 셋 뜬다. 시작 전 `WY-pm`에 알리고 차례를 받는다.

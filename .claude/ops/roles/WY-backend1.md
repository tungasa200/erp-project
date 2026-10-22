---
description: identity-service, 공통 모듈(`backend/common`), `backend/` 루트 빌드, `infra/`.
---
- gradle은 `--no-daemon`과 작은 힙(`-Dorg.gradle.jvmargs=-Xmx512m`)으로, 바뀐 모듈만 compileJava·compileTestJava. 끝나면 java 프로세스가 남지 않았는지 확인. 전체 빌드는 하지 않는다(메모리).
- Docker가 꺼져 있으면 테스트는 PR CI에서 돈다. springdoc 스냅샷은 손으로 갱신하고 CI 스냅샷 테스트로 확인한다.
- 서비스 간 계약과 프론트가 쓰는 계약은 확정 전에 `WY-pm`에 보고한다. 루트 빌드·docker-compose 같은 공유 파일은 `WY-backend2`와 서로 알린다.
- 자기 worktree(`.claude/worktrees/<역할>`, 가지 `wt/<역할>`)에서 일한다(S5, D-42). 다른 역할의 공용 변경(`backend/common`, 생성 타입 등)이 기준 가지(설정 `worktree.base`)에 병합되면 자기 worktree에서 `git merge <기준 가지>`로 받는다. 세션을 띄울 때만 빨리감기되므로, 오래 도는 세션은 받지 않으면 옛 코드로 컴파일한다.
- dev 서버(vite·bootRun)는 띄우지 않는다(D-42). 브라우저 화면 확인은 병합 뒤 `WY-qa`가 본 저장소 dev 서버로 한다.
- backend 빌드·시험은 한 번에 한 역할만 돌린다(`--no-daemon` 유지). worktree마다 build/·.gradle이 따로라 첫 빌드가 전부 돌고, 셋이 겹치면 JVM이 셋 뜬다. 시작 전 `WY-pm`에 알리고 차례를 받는다.

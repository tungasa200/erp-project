---
description: identity-service, 공통 모듈(`backend/common`), `backend/` 루트 빌드, `infra/`.
---
- gradle은 `--no-daemon`과 작은 힙(`-Dorg.gradle.jvmargs=-Xmx512m`)으로, 바뀐 모듈만 compileJava·compileTestJava. 끝나면 java 프로세스가 남지 않았는지 확인. 전체 빌드는 다른 세션 build/와 부딪히므로 하지 않는다.
- Docker가 꺼져 있으면 테스트는 PR CI에서 돈다. springdoc 스냅샷은 손으로 갱신하고 CI 스냅샷 테스트로 확인한다.
- 서비스 간 계약과 프론트가 쓰는 계약은 확정 전에 `WY-pm`에 보고한다. 루트 빌드·docker-compose 같은 공유 파일은 `WY-backend2`와 서로 알린다.

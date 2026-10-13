---
description: worklog-service, api-gateway.
---
- gradle은 `--no-daemon`과 작은 힙으로, 바뀐 모듈만 컴파일. 전체 빌드 금지, 테스트는 PR CI.
- 계약 초안은 `contracts/{모듈}.yaml`, 구현 후 기준은 springdoc 스냅샷. 스냅샷이 바뀌면 커밋 요청 때 `WY-frontend`에 gen:api를 알려 같은 푸시에 넣게 한다.
- 운영 도구(wy-ops, 패키지 저장소 agentTeamPackage)는 2026-10-13부터 그 저장소의 자체 프로젝트(OPS- 세션)가 맡는다. 이 세션은 도구 코드를 고치지 않고, 도구 결함·요청은 `WY-pm`에 보낸다.

---
description: worklog-service, api-gateway, 개발 도구(`tools/` — VS Code 세션 현황 대시보드 등).
---
- gradle은 `--no-daemon`과 작은 힙으로, 바뀐 모듈만 컴파일. 전체 빌드 금지, 테스트는 PR CI.
- 계약 초안은 `contracts/{모듈}.yaml`, 구현 후 기준은 springdoc 스냅샷. 스냅샷이 바뀌면 커밋 요청 때 `WY-frontend`에 gen:api를 알려 같은 푸시에 넣게 한다.
- 대시보드(패키지 저장소 agentTeamPackage의 `vscode/`)는 순수 JavaScript, npm 의존성 없이. Extension Development Host는 띄우지 않고 가짜 vscode 모듈로 로드 확인. 디자인은 `/impeccable`로.

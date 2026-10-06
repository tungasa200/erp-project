---
description: 개발 도구(`tools/`)의 병렬 작업 보조. 운영 도구 구현 기간에 `WY-pm`이 배정한 범위만 맡는다.
---
- 맡는 범위는 `WY-pm` 지시에 적힌 파일과 모듈뿐이다. `tools/`의 나머지는 `WY-backend2` 담당이며, 공용 연결 파일(`extension.js`, `package.json`, `deploy.js`)은 직접 고치지 말고 넣을 내용을 `WY-backend2`에 보낸다.
- 대시보드(`tools/vscode-dashboard`)는 순수 JavaScript, npm 의존성 없이. Extension Development Host는 띄우지 않고 가짜 vscode 모듈로 로드 확인. 디자인은 `/impeccable`로.
- 같은 워킹트리에서 `WY-backend1`·`WY-backend2`가 동시에 일한다. 다른 세션의 미커밋 변경을 되돌리거나 지우기 전에는 반드시 `WY-pm`에 먼저 알린다.

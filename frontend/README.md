# frontend

worklog 프론트엔드 (React + Vite + TypeScript). 화면 기준은 `docs/화면정의서`와 erp-design 목업 캔버스.

## 실행

```bash
npm install
npm run dev        # /api 요청을 로컬 api-gateway(http://localhost:8080)로 프록시
npm run dev:mock   # 백엔드 없이 가짜 서버로 실행 (src/api/mockServer.ts)
```

프록시 대상은 `VITE_API_PROXY_TARGET` 환경변수로 바꿀 수 있다.

목업 모드 체험 계정: `demo@example.com` / `worklog20`
(`locked@example.com`은 로그인 잠금, `error@example.com`은 서버 오류 응답)

## 검사

```bash
npm run build         # 타입 체크 + 빌드
npm run lint          # oxlint
npm run format:check  # Prettier
npm test              # Vitest
```

## 구조

- `src/api/` — fetch 래퍼(401이면 refresh 1회 후 재시도, 동시 갱신은 1회로), Problem Details 오류, 임시 타입
- `src/auth/` — 로그인 상태(React Context + TanStack Query), 비밀번호 규칙
- `src/theme/` — 색 토큰(CSS 변수), 사용자 테마 적용
- `src/app/` — 라우터와 접근 가드
- `src/pages/`, `src/components/` — 화면과 공통 컴포넌트 (CSS Modules)

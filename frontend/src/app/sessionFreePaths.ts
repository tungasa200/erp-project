import { matchRoutes, type RouteObject } from 'react-router'

// 로그인 여부와 상관없이 같은 화면인 경로: 처리방침·약관·404(D-189, REL-08).
// 여기서는 내 정보 조회(/users/me → 401 → /auth/refresh)를 보내지 않아 비로그인 방문자 콘솔에 401이 남지 않는다.
// '/'는 로그인했으면 홈, 아니면 로그인 화면이라 조회가 필요하다.
const SESSION_FREE = new Set(['/privacy', '/terms', '*'])

export function isSessionFreePath(routes: RouteObject[], pathname: string): boolean {
  const leaf = matchRoutes(routes, pathname)?.at(-1)?.route.path
  return leaf !== undefined && SESSION_FREE.has(leaf)
}

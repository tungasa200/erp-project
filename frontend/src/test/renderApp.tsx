import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'
import { setSessionExpiredHandler } from '../api'
import { MaintenanceGate } from '../app/MaintenanceGate'
import { routes } from '../app/router'
import { AuthProvider } from '../auth/AuthContext'
import { handleSessionExpired } from '../auth/session'
import { AppFrame } from '../components/AppFrame'
import { ToastProvider } from '../components/Toast'

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, code, traceId: 'trace-123', ...extra }),
    {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  )
}

export const ME = {
  id: 'u-1',
  email: 'demo@example.com',
  emailVerified: false,
  name: null,
  organization: null,
  position: null,
  timezone: 'Asia/Seoul',
  weekStart: 'MONDAY',
  workDays: 31,
  themeAccent: '#4B3FD6',
  themeGround: '#F2F4FA',
  keyboardShortcutsEnabled: true,
  version: 0,
}

// "METHOD /path" → 응답. 쿼리까지 같은 키가 없으면 쿼리를 뺀 "METHOD /path"로 찾는다.
// 등록하지 않은 요청은 401 UNAUTHENTICATED(비로그인)로 본다.
const EMPTY_LISTS = [
  'GET /api/worklog/projects',
  'GET /api/worklog/tags',
  'GET /api/worklog/tasks',
  'GET /api/worklog/tasks/frequent',
  'GET /api/worklog/schedules',
  'GET /api/worklog/records/pending',
  'GET /api/worklog/records',
]

export function stubFetch(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const handler = handlers[key] ?? handlers[key.split('?')[0]]
    if (handler) return handler(init)
    // 앱 셸(사이드바 프로젝트 목록)·캘린더처럼 여러 화면이 함께 받는 목록은 등록하지 않았으면 빈 목록으로 답한다
    if (EMPTY_LISTS.includes(key.split('?')[0])) return json(200, { items: [], nextCursor: null })
    // 업무를 완료하면 결과 팝오버(SCR-TASK-03)가 닫힐 때 기록을 만든다. 등록하지 않았으면 만든 것으로 답한다
    if (key === 'POST /api/worklog/records') return json(201, { id: 'r-auto', status: 'CONFIRMED' })
    if (key === 'POST /api/auth/refresh') return problem(401, 'REFRESH_INVALID')
    // 시간 기록 옵션(useTimeTracking)을 읽는 화면(홈 ③ 등). 등록하지 않았으면 꺼짐으로 답한다
    if (key === 'GET /api/worklog/me') return json(200, { userId: 'u-1', settings: { timeTrackingEnabled: false } })
    // 옵션이 켜지면 앱 셸 타이머 미니 플레이어가 실행 중인 타이머를 묻는다. 등록하지 않았으면 없음으로 답한다
    if (key === 'GET /api/worklog/timer') return json(200, { running: null })
    return problem(401, 'UNAUTHENTICATED')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function renderApp(path: string, appRoutes: RouteObject[] = routes) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setSessionExpiredHandler((code) => handleSessionExpired(queryClient, code))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppFrame>
          <MaintenanceGate>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </MaintenanceGate>
        </AppFrame>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

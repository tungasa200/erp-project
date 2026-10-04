import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'
import { setSessionExpiredHandler } from '../api'
import { routes } from '../app/router'
import { AuthProvider } from '../auth/AuthContext'
import { handleSessionExpired } from '../auth/session'
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
  version: 0,
}

// "METHOD /path" → 응답. 등록하지 않은 요청은 401 UNAUTHENTICATED(비로그인)로 본다.
export function stubFetch(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const handler = handlers[key]
    if (handler) return handler(init)
    if (key === 'POST /api/auth/refresh') return problem(401, 'REFRESH_INVALID')
    return problem(401, 'UNAUTHENTICATED')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function renderApp(path: string, appRoutes: RouteObject[] = routes) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setSessionExpiredHandler(() => handleSessionExpired(queryClient))
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

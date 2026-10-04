import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ApiError, NetworkError } from './problem'

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, traceId: 't-1' }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// access 토큰 유효 여부만 흉내 내는 가짜 서버
function fakeServer({ refreshOk = true } = {}) {
  let accessValid = false
  let refreshCalls = 0
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/auth/refresh') {
      refreshCalls++
      await new Promise((r) => setTimeout(r, 10))
      if (!refreshOk) return problem(401, 'REFRESH_INVALID')
      accessValid = true
      return new Response(null, { status: 204 })
    }
    if (!accessValid) return problem(401, 'UNAUTHENTICATED')
    return ok({ path, method: init?.method ?? 'GET' })
  }) as unknown as typeof fetch
  return { fetchFn, refreshCalls: () => refreshCalls }
}

describe('createApiClient', () => {
  it('401이면 refresh 후 한 번 재시도한다', async () => {
    const server = fakeServer()
    const onSessionExpired = vi.fn()
    const api = createApiClient({ fetchFn: server.fetchFn, onSessionExpired })

    await expect(api.request('/api/users/me')).resolves.toEqual({ path: '/api/users/me', method: 'GET' })
    expect(server.refreshCalls()).toBe(1)
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('탭 안에서 동시에 401을 받아도 refresh는 한 번만 보낸다', async () => {
    const server = fakeServer()
    const api = createApiClient({ fetchFn: server.fetchFn, onSessionExpired: vi.fn() })

    const results = await Promise.all([
      api.request('/api/users/me'),
      api.request('/api/worklog/me'),
      api.request('/api/worklog/tasks'),
    ])
    expect(results).toHaveLength(3)
    expect(server.refreshCalls()).toBe(1)
  })

  it('요청 중에 다른 요청이 이미 갱신을 마쳤으면 다시 갱신하지 않고 재시도한다', async () => {
    let accessValid = false
    let refreshCalls = 0
    let releaseSlow!: () => void
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/refresh') {
        refreshCalls++
        accessValid = true
        return new Response(null, { status: 204 })
      }
      if (path === '/slow' && !accessValid) {
        // 갱신 전에 보낸 요청의 401이 갱신이 끝난 뒤에 도착하는 상황
        await new Promise<void>((r) => (releaseSlow = r))
        return problem(401, 'UNAUTHENTICATED')
      }
      return accessValid ? ok({ path }) : problem(401, 'UNAUTHENTICATED')
    }) as unknown as typeof fetch
    const api = createApiClient({ fetchFn, onSessionExpired: vi.fn() })

    const slow = api.request('/slow')
    await api.request('/fast')
    releaseSlow()
    await expect(slow).resolves.toEqual({ path: '/slow' })
    expect(refreshCalls).toBe(1)
  })

  it('refresh가 실패하면 세션 만료를 알리고 원래 401 오류를 던진다', async () => {
    const server = fakeServer({ refreshOk: false })
    const onSessionExpired = vi.fn()
    const api = createApiClient({ fetchFn: server.fetchFn, onSessionExpired })

    const error = await api.request<never>('/api/users/me').catch((e: unknown) => e as ApiError)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('UNAUTHENTICATED')
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('USER_DELETED는 refresh 없이 바로 세션 만료로 처리한다', async () => {
    const fetchFn = vi.fn(async () => problem(401, 'USER_DELETED')) as unknown as typeof fetch
    const onSessionExpired = vi.fn()
    const api = createApiClient({ fetchFn, onSessionExpired })

    await expect(api.request('/api/worklog/me')).rejects.toMatchObject({ code: 'USER_DELETED' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('/api/auth/** 의 401(로그인 실패)은 refresh하지 않는다', async () => {
    const fetchFn = vi.fn(async () => problem(401, 'INVALID_CREDENTIALS')) as unknown as typeof fetch
    const onSessionExpired = vi.fn()
    const api = createApiClient({ fetchFn, onSessionExpired })

    await expect(api.request('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('JSON 본문과 쿠키 전송 옵션을 붙여 보낸다', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const api = createApiClient({ fetchFn, onSessionExpired: vi.fn() })

    await expect(api.request('/api/auth/logout', { method: 'POST', body: { a: 1 } })).resolves.toBeUndefined()
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('fetch 자체가 실패하면 NetworkError를 던진다', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const api = createApiClient({ fetchFn, onSessionExpired: vi.fn() })

    await expect(api.request('/api/users/me')).rejects.toBeInstanceOf(NetworkError)
  })
})

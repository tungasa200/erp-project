import { ApiError, NetworkError, toApiError } from './problem'

type FetchFn = typeof fetch

export interface ApiClientOptions {
  fetchFn: FetchFn
  // refresh가 실패해 로그인 상태가 끝났을 때 한 번 호출된다. code는 끝난 이유(USER_DELETED 등).
  onSessionExpired: (code: string | undefined) => void
  // 점검 중(503 + code=MAINTENANCE)일 때 호출된다. retryAt은 Retry-After 헤더로 계산한 시각(없으면 null).
  onMaintenance?: (retryAt: Date | null) => void
}

export interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** 페이지를 떠나는 중에도 요청을 끝까지 보낸다 (지연 삭제 확정, P1-02-07) */
  keepalive?: boolean
}

const REFRESH_PATH = '/api/auth/refresh'

// Retry-After는 남은 초(contracts/gateway.yaml). 형식이 다르면 시각을 모르는 것으로 본다.
function retryAt(res: Response): Date | null {
  const value = res.headers.get('Retry-After')?.trim()
  if (!value || !/^\d+$/.test(value)) return null
  return new Date(Date.now() + Number(value) * 1000)
}

export function createApiClient({ fetchFn, onSessionExpired, onMaintenance = () => {} }: ApiClientOptions) {
  // 탭 안에서 동시에 401을 받아도 refresh는 한 번만 보낸다(single-flight).
  // 결과: 성공하면 null, 실패하면 그 code
  let refreshing: Promise<string | undefined | null> | null = null
  // refresh가 끝날 때마다 증가. 요청을 보낸 뒤에 이미 갱신이 끝났다면 다시 갱신하지 않고 재시도만 한다.
  let refreshCount = 0

  function refresh(): Promise<string | undefined | null> {
    refreshing ??= fetchFn(REFRESH_PATH, { method: 'POST', credentials: 'same-origin' })
      .then(
        async (res) => (res.ok ? null : (await toApiError(res)).code),
        () => undefined,
      )
      .then((failure) => {
        if (failure === null) refreshCount++
        return failure
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  async function send(path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json' }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    try {
      return await fetchFn(path, {
        method: options.method ?? 'GET',
        headers,
        body,
        credentials: 'same-origin',
        signal: options.signal,
        keepalive: options.keepalive,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new NetworkError(e)
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const seenRefreshCount = refreshCount
    let res = await send(path, options)

    // /api/auth/** 의 401은 로그인 실패·refresh 실패이므로 갱신하지 않는다.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      const error = await toApiError(res)
      if (error.code !== 'UNAUTHENTICATED') {
        // USER_DELETED 등: 갱신해도 소용없으므로 바로 로그아웃 처리
        onSessionExpired(error.code)
        throw error
      }
      const failure = refreshCount !== seenRefreshCount ? null : await refresh()
      if (failure !== null) {
        onSessionExpired(failure)
        throw error
      }
      res = await send(path, options)
      if (res.status === 401) {
        const retryError = await toApiError(res)
        onSessionExpired(retryError.code)
        throw retryError
      }
    }

    if (!res.ok) {
      const error = await toApiError(res)
      // 본문이 Problem이 아니거나 code가 다른 503(프록시·플랫폼 응답)은 일반 서버 오류로 둔다.
      if (res.status === 503 && error.code === 'MAINTENANCE') onMaintenance(retryAt(res))
      throw error
    }
    if (res.status === 204 || res.headers.get('Content-Length') === '0') return undefined as T
    return (await res.json()) as T
  }

  return { request }
}

export type ApiClient = ReturnType<typeof createApiClient>
export { ApiError, NetworkError }

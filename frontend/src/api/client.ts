import { ApiError, NetworkError, toApiError } from './problem'

type FetchFn = typeof fetch

export interface ApiClientOptions {
  fetchFn: FetchFn
  // refresh가 실패해 로그인 상태가 끝났을 때 한 번 호출된다.
  onSessionExpired: () => void
}

export interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

const REFRESH_PATH = '/api/auth/refresh'

export function createApiClient({ fetchFn, onSessionExpired }: ApiClientOptions) {
  // 탭 안에서 동시에 401을 받아도 refresh는 한 번만 보낸다(single-flight).
  let refreshing: Promise<boolean> | null = null
  // refresh가 끝날 때마다 증가. 요청을 보낸 뒤에 이미 갱신이 끝났다면 다시 갱신하지 않고 재시도만 한다.
  let refreshCount = 0

  function refresh(): Promise<boolean> {
    refreshing ??= fetchFn(REFRESH_PATH, { method: 'POST', credentials: 'same-origin' })
      .then(
        (res) => res.ok,
        () => false,
      )
      .then((ok) => {
        if (ok) refreshCount++
        return ok
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
        onSessionExpired()
        throw error
      }
      const renewed = refreshCount !== seenRefreshCount || (await refresh())
      if (!renewed) {
        onSessionExpired()
        throw error
      }
      res = await send(path, options)
      if (res.status === 401) {
        onSessionExpired()
        throw await toApiError(res)
      }
    }

    if (!res.ok) throw await toApiError(res)
    if (res.status === 204 || res.headers.get('Content-Length') === '0') return undefined as T
    return (await res.json()) as T
  }

  return { request }
}

export type ApiClient = ReturnType<typeof createApiClient>
export { ApiError, NetworkError }

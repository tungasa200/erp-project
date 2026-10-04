import { createApiClient } from './client'
import { mockFetch } from './mockServer'
import type { LoginRequest, Me, SignupRequest } from './types'

// 백엔드 없이 화면을 볼 때 VITE_API_MOCK=true. fetch 단계만 바꾸므로 클라이언트 로직은 실제와 같다.
const useMock = import.meta.env.VITE_API_MOCK === 'true'

let sessionExpiredHandler: () => void = () => {}

export function setSessionExpiredHandler(handler: () => void) {
  sessionExpiredHandler = handler
}

export const api = createApiClient({
  fetchFn: useMock ? mockFetch : (...args) => fetch(...args),
  onSessionExpired: () => sessionExpiredHandler(),
})

export const authApi = {
  signup: (body: SignupRequest) => api.request<Me>('/api/auth/signup', { method: 'POST', body }),
  login: (body: LoginRequest) => api.request<Me>('/api/auth/login', { method: 'POST', body }),
  logout: () => api.request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => api.request<Me>('/api/users/me'),
}

import { createApiClient } from './client'
import { mockFetch } from './mockServer'
import type { LoginRequest, Me, ProfileUpdateRequest, SignupRequest } from './types'

// 백엔드 없이 화면을 볼 때 VITE_API_MOCK=true. fetch 단계만 바꾸므로 클라이언트 로직은 실제와 같다.
const useMock = import.meta.env.VITE_API_MOCK === 'true'

let sessionExpiredHandler: (code: string | undefined) => void = () => {}

export function setSessionExpiredHandler(handler: (code: string | undefined) => void) {
  sessionExpiredHandler = handler
}

let maintenanceHandler: (retryAt: Date | null) => void = () => {}

export function setMaintenanceHandler(handler: (retryAt: Date | null) => void) {
  maintenanceHandler = handler
}

export const api = createApiClient({
  fetchFn: useMock ? mockFetch : (...args) => fetch(...args),
  onSessionExpired: (code) => sessionExpiredHandler(code),
  onMaintenance: (retryAt) => maintenanceHandler(retryAt),
})

export const authApi = {
  signup: (body: SignupRequest) => api.request<Me>('/api/auth/signup', { method: 'POST', body }),
  login: (body: LoginRequest) => api.request<Me>('/api/auth/login', { method: 'POST', body }),
  logout: () => api.request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => api.request<Me>('/api/users/me'),
  updateMe: (body: ProfileUpdateRequest) => api.request<Me>('/api/users/me', { method: 'PATCH', body }),
}

export const worklogApi = {
  // identity 프로필 저장 직후 worklog 사본을 바로 맞춘다. 응답(WorklogMe)은 아직 화면에서 쓰지 않는다.
  refreshProfile: () => api.request<unknown>('/api/worklog/me/profile/refresh', { method: 'POST' }),
}

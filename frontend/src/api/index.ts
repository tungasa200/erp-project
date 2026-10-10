import { createApiClient } from './client'
import { noteFailedTraceId } from './clientErrors'
import { mockFetch } from './mockServer'
import type {
  AccountDeletionRequest,
  LoginRequest,
  Me,
  PasswordChangeRequest,
  PasswordChanged,
  ProfileUpdateRequest,
  SignupRequest,
  WorklogMe,
  WorklogSettings,
  WorklogSettingsPatch,
} from './types'

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

const baseFetch: typeof fetch = useMock ? mockFetch : (...args) => fetch(...args)

export const api = createApiClient({
  // 실패한 응답의 traceId를 화면 오류 보고(P4-13)에 붙이려고 기억해 둔다
  fetchFn: async (...args) => {
    const res = await baseFetch(...args)
    if (!res.ok) noteFailedTraceId(res.headers.get('X-Trace-Id'))
    return res
  },
  onSessionExpired: (code) => sessionExpiredHandler(code),
  onMaintenance: (retryAt) => maintenanceHandler(retryAt),
})

export const authApi = {
  signup: (body: SignupRequest) => api.request<Me>('/api/auth/signup', { method: 'POST', body }),
  login: (body: LoginRequest) => api.request<Me>('/api/auth/login', { method: 'POST', body }),
  logout: () => api.request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => api.request<Me>('/api/users/me'),
  /** SCR-SET-06 ② (D-173). currentSessionKept=false면 서버가 쿠키를 지웠다 */
  changePassword: (body: PasswordChangeRequest) =>
    api.request<PasswordChanged>('/api/auth/password-change', { method: 'POST', body }),
  /** SCR-SET-07 회원 탈퇴 (D-176). 204면 서버가 쿠키를 지웠다 */
  deleteAccount: (body: AccountDeletionRequest) =>
    api.request<void>('/api/users/me/deletion', { method: 'POST', body }),
  updateMe: (body: ProfileUpdateRequest) => api.request<Me>('/api/users/me', { method: 'PATCH', body }),
}

export const worklogApi = {
  // identity 프로필 저장 직후 worklog 사본을 바로 맞춘다. 응답(WorklogMe)은 아직 화면에서 쓰지 않는다.
  refreshProfile: () => api.request<unknown>('/api/worklog/me/profile/refresh', { method: 'POST' }),
  me: () => api.request<WorklogMe>('/api/worklog/me'),
  /** worklog 전용 설정 수정(SCR-SET-02 ④⑤, SCR-SET-03). 보낸 칸만 바뀐다 */
  updateSettings: (body: WorklogSettingsPatch) =>
    api.request<WorklogSettings>('/api/worklog/me/settings', { method: 'PATCH', body }),
}

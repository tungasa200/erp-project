import { Navigate, Outlet, useLocation } from 'react-router'
import { isSessionExpired } from '../auth/session'
import { useAuth } from '../auth/useAuth'

export interface LoginLocationState {
  from?: string
  expired?: boolean
}

// 로그인 확인 중에는 아무것도 그리지 않는다(0.3초 안에 끝나는 로딩은 표시하지 않음, 화면정의서 2.5).
export function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return null
  if (!user) {
    const state: LoginLocationState = {
      from: location.pathname + location.search + location.hash,
      expired: isSessionExpired(),
    }
    return <Navigate to="/login" replace state={state} />
  }
  return <Outlet />
}

// 로그인·가입에 성공하면 이 가드가 원래 가려던 화면(없으면 홈)으로 보낸다.
export function GuestOnly() {
  const { user, isLoading } = useAuth()
  const state = useLocation().state as LoginLocationState | null
  if (isLoading) return null
  if (user) return <Navigate to={state?.from ?? '/'} replace />
  return <Outlet />
}

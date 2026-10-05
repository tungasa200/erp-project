import { Navigate, Outlet, useLocation } from 'react-router'
import { sessionEndReason, type SessionEndReason } from '../auth/session'
import { useAuth } from '../auth/useAuth'

export interface LoginLocationState {
  from?: string
  reason?: SessionEndReason
}

// 로그인 확인 중에는 아무것도 그리지 않는다(0.3초 안에 끝나는 로딩은 표시하지 않음, 화면정의서 2.5).
export function RequireAuth() {
  const { user, isLoading, error } = useAuth()
  const location = useLocation()
  if (isLoading) return null
  // 로그인 여부를 알 수 없으면 로그인 화면으로 보내지 않고 서버 오류 페이지(SCR-SYS-02 ①)를 보여 준다.
  if (error) throw error
  if (!user) {
    const state: LoginLocationState = {
      from: location.pathname + location.search + location.hash,
      reason: sessionEndReason() ?? undefined,
    }
    return <Navigate to="/login" replace state={state} />
  }
  return <Outlet />
}

// 로그인·가입에 성공하면 이 가드가 원래 가려던 화면(없으면 홈)으로 보낸다.
export function GuestOnly() {
  const { user, isLoading, error } = useAuth()
  const state = useLocation().state as LoginLocationState | null
  if (isLoading) return null
  // 로그인 여부를 알 수 없으면 로그인 화면으로 보내지 않고 서버 오류 페이지(SCR-SYS-02 ①)를 보여 준다.
  if (error) throw error
  if (user) return <Navigate to={state?.from ?? '/'} replace />
  return <Outlet />
}

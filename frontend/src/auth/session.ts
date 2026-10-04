import { createContext } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { LoginRequest, Me, SignupRequest } from '../api/types'

export const ME_QUERY_KEY = ['me'] as const

export interface AuthValue {
  user: Me | null
  isLoading: boolean
  login: (body: LoginRequest) => Promise<Me>
  signup: (body: SignupRequest) => Promise<Me>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

// 로그인 중이던 사용자의 세션이 끝난 이유. 로그인 화면이 "다시 로그인해 주세요"나 탈퇴 안내를 띄우는 데 쓴다.
export type SessionEndReason = 'expired' | 'deleted'
let sessionEnd: SessionEndReason | null = null
export const sessionEndReason = () => sessionEnd

export function setUser(queryClient: QueryClient, me: Me | null) {
  sessionEnd = null
  queryClient.setQueryData(ME_QUERY_KEY, me)
}

// API 클라이언트가 refresh에 실패했을 때 호출. 처음 접속한 비로그인 사용자에게는 안내를 띄우지 않는다.
export function handleSessionExpired(queryClient: QueryClient, code?: string) {
  const wasLoggedIn = Boolean(queryClient.getQueryData(ME_QUERY_KEY))
  setUser(queryClient, null)
  if (wasLoggedIn) sessionEnd = code === 'USER_DELETED' ? 'deleted' : 'expired'
}

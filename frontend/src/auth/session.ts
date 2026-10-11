import { createContext } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { LoginRequest, Me, SignupRequest } from '../api/types'

export const ME_QUERY_KEY = ['me'] as const

export interface AuthValue {
  user: Me | null
  isLoading: boolean
  // 로그인 상태 조회가 401이 아닌 이유(5xx·네트워크)로 실패한 경우. 가드가 오류 페이지로 올린다.
  error: unknown
  login: (body: LoginRequest) => Promise<Me>
  signup: (body: SignupRequest) => Promise<Me>
  logout: () => Promise<void>
  /** 서버가 이미 쿠키를 지운 뒤(비밀번호 변경 currentSessionKept=false) 이 기기의 로그인 상태만 비운다.
   *  reason은 로그인 화면 안내에 쓴다 */
  clearSession: (reason?: SessionEndReason) => void
}

export const AuthContext = createContext<AuthValue | null>(null)

// 로그인 중이던 사용자의 세션이 끝난 이유. 로그인 화면이 "다시 로그인해 주세요"나 탈퇴 안내를 띄우는 데 쓴다.
// passwordChanged: 비밀번호를 바꿨는데 서버가 이 기기를 가려내지 못해 모든 기기를 로그아웃함(SCR-SET-06, D-173)
// withdrawn: 이 기기에서 회원 탈퇴를 마침(SCR-SET-07, D-176). deleted는 다른 곳에서 탈퇴한 계정의 토큰이 남아 있던 경우
// loggedOut: 직접 로그아웃함. 안내는 없고, /에 있었어도 랜딩 대신 로그인 화면으로 보낸다(SCR-AUTH-01)
export type SessionEndReason = 'expired' | 'deleted' | 'passwordChanged' | 'withdrawn' | 'loggedOut'
let sessionEnd: SessionEndReason | null = null
export const sessionEndReason = () => sessionEnd

export function setUser(queryClient: QueryClient, me: Me | null, reason: SessionEndReason | null = null) {
  sessionEnd = reason
  queryClient.setQueryData(ME_QUERY_KEY, me)
}

// API 클라이언트가 refresh에 실패했을 때 호출. 처음 접속한 비로그인 사용자에게는 "다시 로그인해 주세요"를 띄우지 않는다.
// USER_DELETED는 이 기기에 탈퇴한 계정의 토큰이 있었다는 뜻이므로 새로 고침 직후에도 안내한다.
// 화면 이동 때 여러 요청이 함께 401 → refresh 실패가 되면 여러 번 불린다. 두 번째부터는 이미 로그아웃 상태라
// wasLoggedIn이 false이므로, 앞에서 정한 이유를 지우지 않고 그대로 둔다 (P1-X-03)
export function handleSessionExpired(queryClient: QueryClient, code?: string) {
  const wasLoggedIn = Boolean(queryClient.getQueryData(ME_QUERY_KEY))
  const previous = sessionEnd
  setUser(queryClient, null)
  if (code === 'USER_DELETED') sessionEnd = 'deleted'
  else if (wasLoggedIn) sessionEnd = 'expired'
  else sessionEnd = previous
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, type ReactNode } from 'react'
import { authApi } from '../api'
import { ApiError } from '../api/problem'
import type { Me } from '../api/types'
import { applyTheme, DEFAULT_THEME } from '../theme/theme'
import { resetBanner } from '../verification/bannerState'
import { AuthContext, ME_QUERY_KEY, setUser, type AuthValue, type SessionEndReason } from './session'

// 로그인하지 않은 상태(401)는 오류가 아니라 null로 본다.
async function fetchMe(): Promise<Me | null> {
  try {
    return await authApi.me()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isPending, error } = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, staleTime: Infinity })
  const user = data ?? null

  useEffect(() => {
    applyTheme(user?.themeAccent ?? DEFAULT_THEME.accent, user?.themeGround ?? DEFAULT_THEME.ground)
  }, [user?.themeAccent, user?.themeGround])

  const value = useMemo<AuthValue>(() => {
    const clearSession = (reason?: SessionEndReason) => {
      setUser(queryClient, null, reason)
      // 이전 사용자의 서버 데이터가 남지 않게 나머지 캐시를 비운다.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] })
    }
    return {
      user,
      isLoading: isPending,
      error,
      login: async (body) => {
        const me = await authApi.login(body)
        resetBanner() // 미인증 배너는 다음 로그인 때 다시 보인다 (SCR-COM-07)
        setUser(queryClient, me)
        return me
      },
      signup: async (body) => {
        const me = await authApi.signup(body)
        resetBanner()
        setUser(queryClient, me)
        return me
      },
      logout: async () => {
        await authApi.logout().catch(() => undefined)
        clearSession()
      },
      clearSession,
    }
  }, [user, isPending, error, queryClient])

  return <AuthContext value={value}>{children}</AuthContext>
}

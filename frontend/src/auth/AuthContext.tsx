import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { authApi } from '../api'
import { ApiError } from '../api/problem'
import type { Me } from '../api/types'
import type { LocationSource } from '../app/MaintenanceGate'
import { isSessionFreePath } from '../app/sessionFreePaths'
import { disablePush } from '../notifications/push'
import { applyTheme, DEFAULT_THEME } from '../theme/theme'
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

const noSubscribe = () => () => {}

// router를 주면 처리방침·약관·404에서는 내 정보를 조회하지 않는다(D-189). 다른 화면으로 가면 그때 조회한다
export function AuthProvider({
  children,
  router,
}: {
  children: ReactNode
  router?: LocationSource & { routes: RouteObject[] }
}) {
  const queryClient = useQueryClient()
  const pathname = useSyncExternalStore(router?.subscribe ?? noSubscribe, () => router?.state.location.pathname)
  const enabled = !router || pathname === undefined || !isSessionFreePath(router.routes, pathname)
  const { data, isPending, error } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    enabled,
  })
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
        setUser(queryClient, me)
        return me
      },
      signup: async (body) => {
        const me = await authApi.signup(body)
        setUser(queryClient, me)
        return me
      },
      logout: async () => {
        // 처리방침: 로그아웃하면 이 기기 푸시 구독을 지체 없이 파기(D-184 ①). 세션이 살아 있을 때 먼저 지우고, 실패해도 로그아웃은 계속
        await disablePush().catch(() => undefined)
        await authApi.logout().catch(() => undefined)
        clearSession('loggedOut')
      },
      clearSession,
    }
  }, [user, isPending, error, queryClient])

  return <AuthContext value={value}>{children}</AuthContext>
}

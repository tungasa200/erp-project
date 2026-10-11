import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { setMaintenanceHandler } from '../api'
import { useAuth } from '../auth/useAuth'
import { MaintenancePage } from '../pages/MaintenancePage'

// 점검 중에도 그대로 보이는 공개 화면(D-177 ②): 개인정보 처리방침 SCR-AUTH-06, 이용약관 SCR-AUTH-07.
// 랜딩(SCR-AUTH-01, '/')은 로그인하지 않았을 때만 공개 화면이다(로그인했으면 /는 홈이라 점검 화면을 띄운다).
const PUBLIC_PATHS = ['/privacy', '/terms']

const isPublicPath = (pathname: string, signedIn: boolean) =>
  (pathname === '/' && !signedIn) || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

/** 지금 경로를 알기 위한 라우터의 일부(createBrowserRouter·createMemoryRouter 둘 다 맞는다) */
export interface LocationSource {
  state: { location: { pathname: string } }
  subscribe: (listener: () => void) => () => void
}

// 어떤 요청이든 점검 응답을 받으면 라우터 대신 점검 화면을 보여 준다(SCR-SYS-02 ②). 공개 화면에서는 그대로 두고,
// 공개 화면에서 다른 화면으로 가면 그때 점검 화면을 띄운다.
export function MaintenanceGate({ router, children }: { router: LocationSource; children: ReactNode }) {
  const [maintenance, setMaintenance] = useState<{ retryAt: Date | null } | null>(null)
  const pathname = useSyncExternalStore(router.subscribe, () => router.state.location.pathname)
  const { user } = useAuth()

  useEffect(() => {
    setMaintenanceHandler((retryAt) => setMaintenance({ retryAt }))
    return () => setMaintenanceHandler(() => {})
  }, [])

  return maintenance && !isPublicPath(pathname, Boolean(user)) ? (
    <MaintenancePage retryAt={maintenance.retryAt} />
  ) : (
    children
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { setMaintenanceHandler } from '../api'
import { MaintenancePage } from '../pages/MaintenancePage'

// 어떤 요청이든 점검 응답을 받으면 라우터 대신 점검 화면을 보여 준다(SCR-SYS-02 ②).
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const [maintenance, setMaintenance] = useState<{ retryAt: Date | null } | null>(null)

  useEffect(() => {
    setMaintenanceHandler((retryAt) => setMaintenance({ retryAt }))
    return () => setMaintenanceHandler(() => {})
  }, [])

  return maintenance ? <MaintenancePage retryAt={maintenance.retryAt} /> : children
}

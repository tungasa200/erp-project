// 하루 마감 띠 상태(SCR-HOME-01, X-02 C). 홈 빠른 입력 안내 시제(UX-HOME-12)도 같은 기준을 쓴다
import { useAuth } from '../auth/useAuth'
import { holidayName } from '../calendar/holidays'
import { isWorkday, useLog } from '../logs/api'
import { useWorklogMe } from '../settings/useWorklogSettings'

/** 사용자 시간대의 지금이 하루 마감 시각을 지났는지. 설정을 받기 전에는 지나지 않은 것으로 본다(띠가 떴다 사라지지 않게) */
export function useAfterClose(now: number, timeZone: string): boolean {
  const closeTime = useWorklogMe().data?.settings.dailyCloseTime
  if (!closeTime) return false
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return hm >= closeTime.slice(0, 5)
}

export type CloseBandState = 'open' | 'done' | null

/** 띠 상태: open = 마감할 때, done = 오늘 확정함, null = 띠 없음 */
export function useCloseBand(today: string, now: number, timeZone: string): CloseBandState {
  const { user } = useAuth()
  const after = useAfterClose(now, timeZone)
  const log = useLog('DAILY', today)
  if (!after || !log.data) return null
  if (log.data.status === 'CONFIRMED') return 'done'
  const workday = user ? isWorkday(today, user.workDays, holidayName(today)) : true
  if (!workday && log.data.status === 'NO_RECORDS') return null
  return 'open'
}

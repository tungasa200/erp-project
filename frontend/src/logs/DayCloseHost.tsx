// 하루 마감 창을 띄우는 자리 하나(AppShell). openDayClose를 받아 연 순간의 오늘로 고정한다(자정을 넘겨도 마감하던 날이 바뀌지 않게)
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { todayIn } from '../quickInput/dates'
import { DayClose } from './DayClose'
import { registerDayCloseOpener, type DayCloseRequest } from './openDayClose'

export function DayCloseHost() {
  const { user } = useAuth()
  const [open, setOpen] = useState<{ date: string; today: string; timeZone: string; quick: boolean } | null>(null)
  const show = useCallback(
    ({ date, quick = false }: DayCloseRequest) => {
      const timeZone = user?.timezone ?? 'Asia/Seoul'
      const today = todayIn(timeZone)
      setOpen({ date: date ?? today, today, timeZone, quick })
    },
    [user?.timezone],
  )
  useEffect(() => registerDayCloseOpener(show), [show])
  if (!open) return null
  return (
    <DayClose
      // 열린 채 다른 날·방식으로 다시 열면 새로 시작한다
      key={`${open.date}-${open.quick}`}
      date={open.date}
      today={open.today}
      timeZone={open.timeZone}
      quick={open.quick}
      onClose={() => setOpen(null)}
    />
  )
}

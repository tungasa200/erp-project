// 알림 항목의 글자·이동 경로(SCR-COM-05). 컴포넌트 파일과 나눠 둔다(fast refresh)
import { addDays, formatMinutes, toZoned } from '../calendar/time'
import { logHref } from '../logs/api'
import { shortDate } from '../quickInput/dates'
import type { AppNotification } from './api'

export const NOTIFICATIONS_PATH = '/notifications'
export const NOTIFICATION_SETTINGS_PATH = '/settings/notifications'

export interface NotificationText {
  title: string
  sub: string
}

export function notificationText(n: AppNotification, today: string): NotificationText {
  if (n.type === 'DAILY_CLOSE') {
    const count = n.pendingCount ?? 0
    const past = n.date !== today
    const sub =
      count > 0
        ? `확인 대기 ${count}건이 있어요. 1분이면 끝나요`
        : `${past ? '그날' : '오늘'} 남긴 기록을 확정해 하루를 마감해요`
    // 지난 날 알림이면 어느 날 마감인지 붙인다
    return { title: '하루 마감 시간이에요', sub: past ? `${shortDate(n.date, today)} · ${sub}` : sub }
  }
  const start = n.periodStart ?? n.date
  if (n.logType === 'MONTHLY') {
    const month = Number(start.slice(5, 7))
    return { title: `${month}월 월간 일지를 만들 수 있어요`, sub: `${month}월 확정한 일지로 한 달을 정리해요` }
  }
  return {
    title: '주간 일지를 만들 차례예요',
    sub: `${shortDate(start, today)} ~ ${shortDate(addDays(start, 6), today)} 일지로 한 주를 정리해요`,
  }
}

/** 누르면 갈 곳. 하루 마감은 그날 일지에서 마감 창을 연다(AppShell이 ?close=1을 본다) */
export function notificationHref(n: AppNotification): string {
  if (n.type === 'DAILY_CLOSE') return `/logs/daily/${n.date}?close=1`
  return logHref(n.logType === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY', n.periodStart ?? n.date)
}

/** 오늘 18:00 · 어제 18:05 · 10월 1일 · 2025년 10월 1일 (사용자 시간대) */
export function notificationTime(createdAt: string, timeZone: string, today: string): string {
  const z = toZoned(createdAt, timeZone)
  const hm = formatMinutes(z.minutes)
  if (z.date === today) return `오늘 ${hm}`
  if (z.date === addDays(today, -1)) return `어제 ${hm}`
  const [y, m, d] = z.date.split('-').map(Number)
  return z.date.slice(0, 4) === today.slice(0, 4) ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`
}

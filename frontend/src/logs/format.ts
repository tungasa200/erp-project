// 일지 화면들이 함께 쓰는 글자·경로 도우미(컴포넌트 파일과 나눠 둔다 — fast refresh)
import { formatDateLong, formatMinutes, isValidDate, toZoned } from '../calendar/time'
import { isoWeekday, WEEKDAY_NAMES } from '../quickInput/dates'
import { LOG_TYPE_OF, type LogStatus, type LogType } from './api'

export const STATUS_LABEL: Record<LogStatus, string> = {
  CONFIRMED: '확정',
  DRAFT: '초안',
  NOT_WRITTEN: '미작성',
  NO_RECORDS: '기록 없음',
}

/** 경로 → 종류·기간 시작일. 월간 yyyy-mm은 1일로 */
export function parseLogPath(typeParam?: string, dateParam?: string): { type: LogType; start: string } | null {
  const type = LOG_TYPE_OF[typeParam ?? '']
  if (!type || !dateParam) return null
  const start = type === 'MONTHLY' ? `${dateParam}-01` : dateParam
  if (!isValidDate(start)) return null
  if (type === 'MONTHLY' && !/^\d{4}-\d{2}$/.test(dateParam)) return null
  return { type, start }
}

export function periodText(type: LogType, start: string, end: string): string {
  if (type === 'DAILY') return formatDateLong(start)
  if (type === 'MONTHLY') return `${start.slice(0, 4)}년 ${Number(start.slice(5, 7))}월`
  const [, em, ed] = end.split('-').map(Number)
  const endYear = end.slice(0, 4) === start.slice(0, 4) ? '' : `${end.slice(0, 4)}년 `
  return `${formatDateLong(start)} ~ ${endYear}${em}월 ${ed}일 (${WEEKDAY_NAMES[isoWeekday(end) - 1]})`
}

/** 확정 2026-10-07 18:04 (사용자 시간대) */
export function stamp(iso: string | null, timeZone: string): string {
  if (!iso) return ''
  const z = toZoned(iso, timeZone)
  return `${z.date} ${formatMinutes(z.minutes)}`
}

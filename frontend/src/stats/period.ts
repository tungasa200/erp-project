// 통계 기간 (SCR-STAT-01 ①): 이번 주 / 이번 달 / 직접 선택. 날짜는 'yyyy-mm-dd', 양끝 포함.
// 주는 프로필의 주 시작 요일로 나눈다. 직접 선택은 400일까지(계약의 집계 기간 상한과 같다).
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  isValidDate,
  startOfMonth,
  startOfWeek,
  type Weekday,
} from '../calendar/time'

export type PeriodKind = 'week' | 'month' | 'custom'

export interface Period {
  kind: PeriodKind
  from: string
  to: string
}

export const MAX_PERIOD_DAYS = 400

export function thisWeek(today: string, weekStart: Weekday): Period {
  const from = startOfWeek(today, weekStart)
  return { kind: 'week', from, to: addDays(from, 6) }
}

export function thisMonth(today: string): Period {
  const from = startOfMonth(today)
  const [y, m] = from.split('-').map(Number)
  return { kind: 'month', from, to: `${from.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, '0')}` }
}

/** 직접 선택 값 검사. 맞으면 null, 틀리면 화면에 보일 문구 */
export function rangeError(from: string, to: string): string | null {
  if (!isValidDate(from) || !isValidDate(to)) return '시작일과 종료일을 골라 주세요'
  if (from > to) return '시작일을 종료일보다 앞으로 골라 주세요'
  if (diffDays(from, to) + 1 > MAX_PERIOD_DAYS) return `기간은 ${MAX_PERIOD_DAYS}일까지 고를 수 있어요`
  return null
}

/** 주소(?period=week|month|custom&from&to)에서 기간을 읽는다. 없거나 틀리면 이번 달(목업 기본값) */
export function readPeriod(search: URLSearchParams, today: string, weekStart: Weekday): Period {
  const kind = search.get('period')
  if (kind === 'week') return thisWeek(today, weekStart)
  if (kind === 'custom') {
    const from = search.get('from') ?? ''
    const to = search.get('to') ?? ''
    if (rangeError(from, to) === null) return { kind: 'custom', from, to }
  }
  return thisMonth(today)
}

export function writePeriod(period: Period): URLSearchParams {
  const search = new URLSearchParams()
  if (period.kind === 'month') return search
  search.set('period', period.kind)
  if (period.kind === 'custom') {
    search.set('from', period.from)
    search.set('to', period.to)
  }
  return search
}

/** 9/1 (해가 다르면 2025/9/1) */
export function shortDay(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return date.slice(0, 4) === today.slice(0, 4) ? `${m}/${d}` : `${y}/${m}/${d}`
}

/** 9/1–9/30 */
export function rangeLabel(from: string, to: string, today: string): string {
  return `${shortDay(from, today)}–${shortDay(to, today)}`
}

/** 기간 고르기의 빠른 선택: 지난주, 지난달, 최근 3개월 */
export function quickRanges(today: string, weekStart: Weekday): { label: string; from: string; to: string }[] {
  const week = startOfWeek(today, weekStart)
  const lastMonth = thisMonth(addMonths(startOfMonth(today), -1))
  return [
    { label: '지난주', from: addDays(week, -7), to: addDays(week, -1) },
    { label: '지난달', from: lastMonth.from, to: lastMonth.to },
    { label: '최근 3개월', from: addDays(addMonths(today, -3), 1), to: today },
  ]
}

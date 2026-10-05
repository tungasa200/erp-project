// 캘린더 날짜·시각 계산. 라이브러리 없이 Intl만 쓴다.
// 날짜는 'yyyy-mm-dd' 문자열(시간대 없는 달력 날짜), 하루 안의 시각은 0시부터 분(0~1440)으로 다룬다.
// 시각(instant)과 날짜를 오갈 때는 항상 시간대를 지정한다: 표시는 사용자의 현재 시간대(D-40).

export type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

/** Date.getUTCDay() 순서(일=0) */
export const WEEKDAYS: Weekday[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

export const MINUTES_PER_DAY = 24 * 60
export const SLOT_MINUTES = 15

const pad = (n: number) => String(n).padStart(2, '0')

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** b - a (일) */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000)
}

/** 일=0 … 토=6 */
export function weekdayIndex(date: string): number {
  return toUtc(date).getUTCDay()
}

export function startOfWeek(date: string, weekStart: Weekday): string {
  const offset = (weekdayIndex(date) - WEEKDAYS.indexOf(weekStart) + 7) % 7
  return addDays(date, -offset)
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 월 단위 이동. 없는 날짜(31일 → 30일까지인 달)는 그달 마지막 날로 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`
}

/** 월 보기의 6주 × 7일 첫 칸 */
export function monthGridStart(date: string, weekStart: Weekday): string {
  return startOfWeek(startOfMonth(date), weekStart)
}

// ── 시간대 변환

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** 그 시각의 시간대 오프셋(분, UTC보다 앞서면 양수) */
function offsetMinutes(epochMs: number, timeZone: string): number {
  const parts: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000)
}

/** 시각 → 그 시간대의 날짜와 0시부터 분 */
export function toZoned(instant: string | number, timeZone: string): { date: string; minutes: number } {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant)
  const local = new Date(ms + offsetMinutes(ms, timeZone) * 60_000)
  return { date: fromUtc(local), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() }
}

/**
 * 시간대의 벽시계 날짜·분 → 시각(ISO, UTC). minutes는 1440(다음 날 0시)까지 받는다.
 * 서머타임으로 없는 시각은 뒤로 밀리고, 두 번 있는 시각은 앞쪽을 쓴다.
 */
export function fromZoned(date: string, minutes: number, timeZone: string): string {
  const guess = toUtc(date).getTime() + minutes * 60_000
  // 앞뒤 하루의 오프셋으로 후보를 만들고, 벽시계로 되돌렸을 때 같은 후보만 남긴다.
  const candidates = [...new Set([-1, 1].map((d) => offsetMinutes(guess + d * 86_400_000, timeZone)))].map(
    (offset) => guess - offset * 60_000,
  )
  const exact = candidates.filter((ms) => ms + offsetMinutes(ms, timeZone) * 60_000 === guess)
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates)).toISOString()
}

export function todayIn(timeZone: string, now = Date.now()): string {
  return toZoned(now, timeZone).date
}

// ── 표시

export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function snapMinutes(minutes: number, step = SLOT_MINUTES): number {
  return Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(minutes / step) * step))
}

/** 2026년 10월 6일 (화) */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayIndex(date)]})`
}

export function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return fromUtc(toUtc(value)) === value
}

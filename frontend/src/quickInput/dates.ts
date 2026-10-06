// 시간대 없는 날짜(YYYY-MM-DD) 계산. 날짜 경계는 사용자 시간대 기준이라(NFR-04)
// "오늘"은 todayIn()으로 한 번만 구하고, 나머지 계산은 시각 없이 날짜끼리만 한다.

const DAY_MS = 86_400_000
export const WEEKDAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'] as const

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function makeDate(year: number, month: number, day: number): string | null {
  const ms = Date.UTC(year, month - 1, day)
  const d = new Date(ms)
  // 2/30처럼 넘친 날짜는 Date가 다음 달로 넘기므로 되돌려 확인한다.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return fromUtc(ms)
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

/** ISO 요일: 월=1 … 일=7 */
export function isoWeekday(date: string): number {
  return ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA 형식이 YYYY-MM-DD다.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 미리보기 칩용 짧은 날짜: 10/8(목) */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}(${WEEKDAY_NAMES[isoWeekday(date) - 1]})`
}

const WEEK_START_CODES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

/** 프로필의 weekStart(MONDAY…)를 ISO 요일 번호로 */
export function weekStartNumber(weekStart: string | undefined): number {
  const i = WEEK_START_CODES.indexOf(weekStart ?? '')
  return i < 0 ? 1 : i + 1
}

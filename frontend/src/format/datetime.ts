// 날짜·시간 표기 공용 함수(X-13). 화면정의서 표기: 짧은 날짜 "10/8(목)", 시간 범위 "14:00 – 15:00".
// 시각(instant)은 언제나 사용자 시간대로 바꿔 쓴다. 기기 시간대(Date#getHours 등)는 쓰지 않는다(SYS-02).
// 날짜(YYYY-MM-DD)는 시간대 없는 값이라 그대로 계산한다.

export const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'] as const

const pad = (n: number) => String(n).padStart(2, '0')

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
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** 시각 → 그 시간대의 날짜(YYYY-MM-DD)와 0시부터 분 */
export function toZoned(instant: string | number | Date, timeZone: string): { date: string; minutes: number } {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant)
  const p: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(ms)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** 그 시간대의 오늘(YYYY-MM-DD) */
export function todayIn(timeZone: string, now: number | Date = Date.now()): string {
  return toZoned(now, timeZone).date
}

/** 0시부터 분 → "14:00". 1440은 "24:00" */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** 시각 → 사용자 시간대의 "14:00" */
export function clock(instant: string | number | Date, timeZone: string): string {
  return formatMinutes(toZoned(instant, timeZone).minutes)
}

function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** 짧은 날짜: 올해면 "10/8(목)", 다른 해면 "2025/10/8(수)". today는 사용자 시간대의 오늘 */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : `${y}/`
  return `${year}${m}/${d}(${weekdayOf(date)})`
}

/** 긴 날짜: "2026년 10월 6일 (화)" */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 (${weekdayOf(date)})`
}

/** 시간 범위: "14:00 – 15:00". 끝이 다른 날이면 "23:00 – 10/9(목) 01:00" */
export function timeRange(start: string | number, end: string | number, timeZone: string): string {
  const s = toZoned(start, timeZone)
  const e = toZoned(end, timeZone)
  const endText =
    e.date === s.date ? formatMinutes(e.minutes) : `${shortDate(e.date, todayIn(timeZone))} ${formatMinutes(e.minutes)}`
  return `${formatMinutes(s.minutes)} – ${endText}`
}

/** 찍힌 시각: "2026-10-07 18:04"(사용자 시간대) */
export function stamp(instant: string | number | Date, timeZone: string): string {
  const z = toZoned(instant, timeZone)
  return `${z.date} ${formatMinutes(z.minutes)}`
}

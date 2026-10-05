// REC-04 한 줄 빠른 입력 파서 (P1-09). 문법 범위를 작게 시작해 넓혀 간다(작업계획서 위험 대응).
//
// 공백으로 나눈 낱말을 순서와 관계없이 읽는다. 태그 말고는 종류마다 처음 나온 것만 쓰고,
// 해석하지 못한 낱말과 두 번째부터 나온 같은 종류 낱말은 제목에 그대로 남는다.
//   시간    14-16 · 9:30-10:30   24시간제. 끝이 시작보다 이르면 오후로 본다(11-1 → 11:00–13:00)
//   날짜    오늘 · 내일 · 모레 · 어제 · 수요일 · 이번주/다음주/다다음주/지난주 수(요일) · 10/12 · 10월 12일
//           요일만 쓰면 오늘을 포함해 가장 가까운 그 요일. 한 글자 요일은 주 앞말이나 ~ 뒤에서만 받는다("일 정리" 오해석 방지)
//           월/일만 쓰면 오늘에서 가장 가까운 해
//   마감    ~ 뒤에 날짜: ~금 · ~내일 · ~10/12 · ~다음주 수요일
//   프로젝트 @이름 (P1-02 결정 B안: @는 프로젝트, #은 태그)
//   태그    #이름 · 여러 개 가능, 같은 이름(대소문자 무시)은 하나로. 이름 규칙은 1~30자, 공백·# 없음(계약 TagName)
//   우선순위 !높음 · !보통 · !낮음
import { addDays, daysBetween, isoWeekday, makeDate, WEEKDAY_NAMES } from './dates'

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW'

export interface QuickParse {
  title: string
  /** 시각 없이 쓴 날짜 (YYYY-MM-DD) */
  date?: string
  /** 날짜로 해석한 원래 글자 (예: "다음주 수요일") */
  dateText?: string
  time?: { start: string; end: string }
  project?: string
  /** 입력 순서대로 */
  tags?: string[]
  priority?: Priority
  due?: string
}

export interface ParseOptions {
  /** 사용자 시간대 기준 오늘 (YYYY-MM-DD) */
  today: string
  /** 주 시작 요일, ISO 번호(월=1 … 일=7). 기본 월요일 */
  weekStart?: number
}

const PRIORITY: Record<string, Priority> = { '!높음': 'HIGH', '!보통': 'MEDIUM', '!낮음': 'LOW' }
const RELATIVE_DAY: Record<string, number> = { 어제: -1, 오늘: 0, 내일: 1, 모레: 2 }
const WEEK_OFFSET: Record<string, number> = { 지난: -1, 이번: 0, 다음: 1, 다다음: 2 }

interface Match {
  date: string
  len: number
}

function weekdayOf(word: string | undefined, allowShort: boolean): number | null {
  const m = word === undefined ? null : /^([월화수목금토일])(요일)?$/.exec(word)
  if (!m || (!m[2] && !allowShort)) return null
  return WEEKDAY_NAMES.indexOf(m[1] as (typeof WEEKDAY_NAMES)[number]) + 1
}

function dayInWeek(today: string, weekStart: number, offset: number, weekday: number): string {
  const startOfWeek = addDays(today, -((isoWeekday(today) - weekStart + 7) % 7))
  return addDays(startOfWeek, offset * 7 + ((weekday - weekStart + 7) % 7))
}

function nearestYear(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4))
  const candidates = [year - 1, year, year + 1]
    .map((y) => makeDate(y, month, day))
    .filter((d): d is string => d !== null)
  if (candidates.length === 0) return null
  return candidates.reduce((best, d) =>
    Math.abs(daysBetween(today, d)) < Math.abs(daysBetween(today, best)) ? d : best,
  )
}

function matchDate(tokens: string[], i: number, opts: Required<ParseOptions>, allowShort: boolean): Match | null {
  const { today, weekStart } = opts
  const t = tokens[i]

  if (Object.hasOwn(RELATIVE_DAY, t)) return { date: addDays(today, RELATIVE_DAY[t]), len: 1 }

  const weekday = weekdayOf(t, allowShort)
  if (weekday) return { date: addDays(today, (weekday - isoWeekday(today) + 7) % 7), len: 1 }

  // 다음주수요일 · 다음주 수요일 · 다음 주 수요일
  const joined = /^(지난|이번|다음|다다음)주(.*)$/.exec(t)
  if (joined) {
    const offset = WEEK_OFFSET[joined[1]]
    const wd = joined[2] ? weekdayOf(joined[2], true) : weekdayOf(tokens[i + 1], true)
    if (wd) return { date: dayInWeek(today, weekStart, offset, wd), len: joined[2] ? 1 : 2 }
    return null
  }
  if (Object.hasOwn(WEEK_OFFSET, t) && tokens[i + 1] === '주') {
    const wd = weekdayOf(tokens[i + 2], true)
    if (wd) return { date: dayInWeek(today, weekStart, WEEK_OFFSET[t], wd), len: 3 }
    return null
  }

  // 10/12 · 10월12일 · 10월 12일
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(t) ?? /^(\d{1,2})월(\d{1,2})일$/.exec(t)
  if (slash) {
    const date = nearestYear(today, Number(slash[1]), Number(slash[2]))
    return date ? { date, len: 1 } : null
  }
  const month = /^(\d{1,2})월$/.exec(t)
  const day = tokens[i + 1] === undefined ? null : /^(\d{1,2})일$/.exec(tokens[i + 1])
  if (month && day) {
    const date = nearestYear(today, Number(month[1]), Number(day[1]))
    return date ? { date, len: 2 } : null
  }
  return null
}

function toMinutes(h: string, m: string | undefined): number | null {
  const hour = Number(h)
  const minute = m === undefined ? 0 : Number(m)
  if (minute > 59 || hour > 24 || (hour === 24 && minute > 0)) return null
  return hour * 60 + minute
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

function matchTime(t: string): { start: string; end: string } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?[-–](\d{1,2})(?::(\d{2}))?$/.exec(t)
  if (!m) return null
  const start = toMinutes(m[1], m[2])
  let end = toMinutes(m[3], m[4])
  if (start === null || end === null || start >= 24 * 60) return null
  if (end <= start && end < 12 * 60) end += 12 * 60
  if (end <= start || end > 24 * 60) return null
  return { start: hhmm(start), end: hhmm(end) }
}

export function parseQuickInput(text: string, options: ParseOptions): QuickParse {
  const opts = { today: options.today, weekStart: options.weekStart ?? 1 }
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const result: QuickParse = { title: '' }
  const rest: string[] = []

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]

    const time = result.time ? null : matchTime(t)
    if (time) {
      result.time = time
      i += 1
      continue
    }
    if (!result.project && /^@\S{1,50}$/.test(t)) {
      result.project = t.slice(1)
      i += 1
      continue
    }
    if (/^#[^\s#]{1,30}$/.test(t)) {
      const tag = t.slice(1)
      const tags = (result.tags ??= [])
      if (!tags.some((x) => x.toLowerCase() === tag.toLowerCase())) tags.push(tag)
      i += 1
      continue
    }
    if (!result.priority && Object.hasOwn(PRIORITY, t)) {
      result.priority = PRIORITY[t]
      i += 1
      continue
    }
    if (!result.due && t.length > 1 && t.startsWith('~')) {
      const due = matchDate([t.slice(1), ...tokens.slice(i + 1)], 0, opts, true)
      if (due) {
        result.due = due.date
        i += due.len
        continue
      }
    }
    const date = result.date ? null : matchDate(tokens, i, opts, false)
    if (date) {
      result.date = date.date
      result.dateText = tokens.slice(i, i + date.len).join(' ')
      i += date.len
      continue
    }

    rest.push(t)
    i += 1
  }

  result.title = rest.join(' ')
  return result
}

/** 저장할 내용. 시간이 있으면 업무+일정, 없으면 업무만 (SCR-COM-02) */
export interface QuickDraft {
  title: string
  project?: string
  tags?: string[]
  priority?: Priority
  due?: string
  schedule?: { date: string; start: string; end: string }
}

export function toDraft(parsed: QuickParse, today: string): QuickDraft {
  const { title, project, tags, priority, due, date, dateText, time } = parsed
  if (time) return { title, project, tags, priority, due, schedule: { date: date ?? today, ...time } }
  // 시각 없이 쓴 날짜는 마감으로 본다. ~ 마감이 따로 있으면 날짜 글자를 제목에 돌려놓는다 (P1-09 결정 A안).
  if (date && !due) return { title, project, tags, priority, due: date }
  return { title: dateText ? `${dateText} ${title}`.trim() : title, project, tags, priority, due }
}

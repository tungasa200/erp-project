// REC-04 한 줄 빠른 입력 파서 (P1-09). 문법 범위를 작게 시작해 넓혀 간다(작업계획서 위험 대응).
//
// 공백으로 나눈 낱말을 순서와 관계없이 읽는다. 태그 말고는 종류마다 처음 나온 것만 쓰고,
// 해석하지 못한 낱말과 두 번째부터 나온 같은 종류 낱말은 제목에 그대로 남는다.
//   시간    14-16 · 9:30-10:30 · 9:00~10:00 · 14:00 - 15:00 · 14시-15시 · 오후 2시~3시 · 14시 30분-15시
//           24시간제. 구분자는 - – ~ ～ 〜, 앞뒤 공백 허용. 오전/오후를 붙일 수 있다.
//           끝이 시작보다 이르면 오후로 본다(11-1 → 11:00–13:00). 끝에 오전/오후를 쓰면 그대로 둔다
//           시각 하나(15:00 · 14시 · 오후 3시)는 1시간 일정. 숫자만(14)은 시각으로 보지 않는다
//   날짜    오늘 · 내일 · 모레 · 어제 · 수요일 · 이번주/다음주/다다음주/지난주 수(요일) · 10/12 · 10월 12일
//           요일만 쓰면 오늘을 포함해 가장 가까운 그 요일. 한 글자 요일은 주 앞말이나 ~ 뒤에서만 받는다("일 정리" 오해석 방지)
//           월/일만 쓰면 오늘에서 가장 가까운 해
//   마감    ~ 뒤에 날짜: ~금 · ~내일 · ~10/12 · ~다음주 수요일
//   프로젝트 @이름 (P1-02 결정 B안: @는 프로젝트, #은 태그)
//   태그    #이름 · 여러 개 가능, 같은 이름(대소문자 무시)은 하나로. 이름 규칙은 1~30자, 공백·# 없음(계약 TagName)
//   우선순위 !높음 · !보통 · !낮음
import { addDays, daysBetween, isoWeekday, makeDate, WEEKDAY_NAMES } from './dates'

// 계약(worklog TaskPriority)과 같은 값
export type Priority = 'HIGH' | 'NORMAL' | 'LOW'

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
  /** 해석한 낱말이 원문에서 차지하는 [시작, 끝) 글자 위치. 칩 수정 드롭다운이 그 낱말만 바꿔 쓴다 (P1-09-12) */
  spans: QuickSpans
}

export type Span = [number, number]

export interface QuickSpans {
  time?: Span
  date?: Span
  project?: Span
  priority?: Span
  due?: Span
  /** 태그 이름(소문자) → 위치 */
  tags?: Record<string, Span>
}

export interface ParseOptions {
  /** 사용자 시간대 기준 오늘 (YYYY-MM-DD) */
  today: string
  /** 주 시작 요일, ISO 번호(월=1 … 일=7). 기본 월요일 */
  weekStart?: number
}

const PRIORITY: Record<string, Priority> = { '!높음': 'HIGH', '!보통': 'NORMAL', '!낮음': 'LOW' }
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

// 시각 하나: [오전|오후] 14 | 14:30 | 14시 | 14시 30분. 묶음 4개(오전/오후, 시, :분, 분)
const POINT = String.raw`(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)?`
// 낱말 경계에서 끝나야 한다(3시간·14:00부터는 시각이 아님). 여러 낱말에 걸칠 수 있다
const RANGE_RE = new RegExp(String.raw`^${POINT}\s*[-–~～〜]\s*${POINT}(?=\s|$)`)
const SINGLE_RE = new RegExp(String.raw`^${POINT}(?=\s|$)`)

/** 묶음 4개로 분 단위 시각. 오후는 12를 더하고 오전 12시는 0시. 오전/오후에 13 이상은 잘못 */
function pointMinutes(meridiem: string | undefined, h: string, colonMin?: string, korMin?: string): number | null {
  let hour = Number(h)
  if (meridiem && hour > 12) return null
  if (meridiem === '오후' && hour < 12) hour += 12
  if (meridiem === '오전' && hour === 12) hour = 0
  return toMinutes(String(hour), colonMin ?? korMin)
}

/** text 맨 앞에서 시간을 읽는다. length는 읽은 글자 수(낱말 여러 개일 수 있음) */
function matchTime(text: string): { start: string; end: string; length: number } | null {
  const range = RANGE_RE.exec(text)
  if (range) {
    const start = pointMinutes(range[1], range[2], range[3], range[4])
    let end = pointMinutes(range[5], range[6], range[7], range[8])
    if (start !== null && end !== null && start < 24 * 60) {
      if (end <= start && end < 12 * 60 && !range[5]) end += 12 * 60
      if (end > start && end <= 24 * 60) return { start: hhmm(start), end: hhmm(end), length: range[0].length }
    }
  }
  // 범위로 못 읽었으면 앞 시각 하나만. 숫자만 쓴 것(:·시 없음)은 시각이 아니다
  const single = SINGLE_RE.exec(text)
  if (!single || (single[3] === undefined && !/시/.test(single[0]))) return null
  const start = pointMinutes(single[1], single[2], single[3], single[4])
  if (start === null || start + 60 > 24 * 60) return null
  return { start: hhmm(start), end: hhmm(start + 60), length: single[0].length }
}

// 시간처럼 생겼는데 읽지 못한 낱말: 15:00까지 · 14—15 · 24-1 · 전각 숫자. 3시간·2-3개는 아니다
const TIMEISH_RE =
  /^(?:오전|오후)?[0-9０-９]{1,2}(?:[:：][0-9０-９]{2}|시(?!간))|^[0-9０-９]{1,2}(?:[:：][0-9０-９]{2})?[-–—~～〜][0-9０-９]{1,2}(?:[:：][0-9０-９]{2})?$/

/** 제목에 남은 낱말 중 시간으로 읽지 못한 첫 낱말 (입력창 안내용) */
export function unreadTimeWord(title: string): string | undefined {
  return title.split(/\s+/).find((w) => TIMEISH_RE.test(w))
}

export function parseQuickInput(text: string, options: ParseOptions): QuickParse {
  const opts = { today: options.today, weekStart: options.weekStart ?? 1 }
  const found = [...text.matchAll(/\S+/g)]
  const tokens = found.map((m) => m[0])
  const span = (from: number, len: number): Span => {
    const last = found[from + len - 1]
    return [found[from].index, last.index + last[0].length]
  }
  const spans: QuickSpans = {}
  const result: QuickParse = { title: '', spans }
  const rest: string[] = []

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]

    const time = result.time ? null : matchTime(text.slice(found[i].index))
    if (time) {
      result.time = { start: time.start, end: time.end }
      // 읽은 글자가 끝나는 낱말까지 한 칩으로 묶는다
      const endAt = found[i].index + time.length
      let len = 1
      while (found[i + len - 1].index + found[i + len - 1][0].length < endAt) len += 1
      spans.time = span(i, len)
      i += len
      continue
    }
    if (!result.project && /^@\S{1,50}$/.test(t)) {
      result.project = t.slice(1)
      spans.project = span(i, 1)
      i += 1
      continue
    }
    if (/^#[^\s#]{1,30}$/.test(t)) {
      const tag = t.slice(1)
      const tags = (result.tags ??= [])
      if (!tags.some((x) => x.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag)
        ;(spans.tags ??= {})[tag.toLowerCase()] = span(i, 1)
      }
      i += 1
      continue
    }
    if (!result.priority && Object.hasOwn(PRIORITY, t)) {
      result.priority = PRIORITY[t]
      spans.priority = span(i, 1)
      i += 1
      continue
    }
    if (!result.due && t.length > 1 && t.startsWith('~')) {
      const due = matchDate([t.slice(1), ...tokens.slice(i + 1)], 0, opts, true)
      if (due) {
        result.due = due.date
        spans.due = span(i, due.len)
        i += due.len
        continue
      }
    }
    const date = result.date ? null : matchDate(tokens, i, opts, false)
    if (date) {
      result.date = date.date
      result.dateText = tokens.slice(i, i + date.len).join(' ')
      spans.date = span(i, date.len)
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

/** 원문의 span 자리를 replacement로 바꾼다. 빈 글자면 그 낱말을 빼고 앞뒤 공백을 하나로 줄인다 */
export function replaceSpan(text: string, [start, end]: Span, replacement: string): string {
  if (replacement !== '') return text.slice(0, start) + replacement + text.slice(end)
  const before = text.slice(0, start).replace(/\s+$/, '')
  const after = text.slice(end).replace(/^\s+/, '')
  return before && after ? `${before} ${after}` : before + after
}

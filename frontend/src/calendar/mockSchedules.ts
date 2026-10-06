// 개발용 가짜 일정 서버 (contracts/worklog.yaml 일정 절). mockServer가 로그인 확인 뒤 /api/worklog/schedules를 여기로 넘긴다.
// 반복 전개는 서버 규칙(D-69~71)을 따른다: 회차 키는 원래 시작 시각, 시각·규칙을 바꾸면 회차별 변경을 지운다.
import type { Occurrence, OccurrencePatch, Recurrence, Schedule } from './api'
import { WEEKDAYS, addDays, diffDays, fromZoned, toZoned, todayIn, weekdayIndex } from './time'

const STORE_KEY = 'worklog.mock.schedules'
/** 업무는 api/mockWorklog가 이 키에 둔다(처음 불러올 때 저장) */
const WORKLOG_STORE_KEY = 'worklog.mock.worklog'

type Override = Partial<Pick<Occurrence, 'title' | 'memo' | 'startAt' | 'endAt' | 'startDate' | 'endDate'>> & {
  deleted?: boolean
}

interface MockSchedule extends Schedule {
  /** 회차 키(occurrenceStart) → "이 일정만" 변경·삭제 */
  overrides: Record<string, Override>
}

type Respond = {
  json: (status: number, body: unknown) => Response
  problem: (status: number, code: string, extra?: Record<string, unknown>) => Response
}

const now = () => new Date().toISOString()
const newId = () => `mock-schedule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'

function seed(): MockSchedule[] {
  const tz = browserZone()
  const today = todayIn(tz)
  const timed = (
    id: string,
    title: string,
    dayOffset: number,
    start: number,
    end: number,
    extra: Partial<Schedule> = {},
  ) => {
    const date = addDays(today, dayOffset)
    return schedule(id, title, tz, {
      allDay: false,
      startAt: fromZoned(date, start * 60, tz),
      endAt: fromZoned(date, end * 60, tz),
      ...extra,
    })
  }
  // 매주 반복은 시작일의 요일을 포함해야 한다(D-71). 주말에 처음 열어도 규칙이 맞게 오늘 요일을 더한다.
  const weekdays = [...new Set([...WEEKDAYS.slice(1, 6), WEEKDAYS[weekdayIndex(today)]])]
  // ID를 고정해 새 브라우저에서도 같은 예시 일정을 가리킨다.
  return [
    timed('mock-schedule-standup', '팀 스탠드업', 0, 9.5, 10, { recurrence: { frequency: 'WEEKLY', weekdays } }),
    timed('mock-schedule-quote', '견적서 작성', 0, 14, 16),
    timed('mock-schedule-review', '코드 리뷰', 1, 10, 11.5),
    timed('mock-schedule-client', '고객사 미팅', 2, 15, 16),
    schedule('mock-schedule-trip', '부산 출장', tz, {
      allDay: true,
      startDate: addDays(today, 3),
      endDate: addDays(today, 4),
    }),
  ]
}

function schedule(id: string, title: string, timezone: string, fields: Partial<Schedule>): MockSchedule {
  return {
    id,
    title,
    allDay: false,
    startAt: null,
    endAt: null,
    startDate: null,
    endDate: null,
    timezone,
    recurrence: null,
    taskId: null,
    memo: null,
    createdAt: now(),
    updatedAt: now(),
    version: 0,
    overrides: {},
    ...fields,
  }
}

function load(): MockSchedule[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as MockSchedule[]
  } catch {
    // 저장소를 못 쓰면 예시 데이터로 시작
  }
  const seeded = seed()
  save(seeded)
  return seeded
}

function save(state: MockSchedule[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    // 무시
  }
}

// ── 반복 전개

/** 시작 날짜(일정 시간대)에서 규칙에 맞는 회차 날짜를 차례로 낸다. count는 삭제한 회차도 센다 */
function* seriesDates(start: string, recurrence: Recurrence | null | undefined): Generator<string> {
  if (!recurrence) {
    yield start
    return
  }
  const startDay = Number(start.slice(8, 10))
  let produced = 0
  // 끝없는 반복은 호출하는 쪽이 기간 끝에서 멈춘다. 안전장치로 30년까지만 본다.
  for (let i = 0; i < 366 * 30; i++) {
    const date = addDays(start, i)
    if (recurrence.until && date > recurrence.until) return
    const matches =
      recurrence.frequency === 'DAILY' ||
      (recurrence.frequency === 'WEEKLY' && (recurrence.weekdays ?? []).includes(WEEKDAYS[weekdayIndex(date)])) ||
      (recurrence.frequency === 'MONTHLY' && Number(date.slice(8, 10)) === startDay)
    if (!matches) continue
    yield date
    produced++
    if (recurrence.count && produced >= recurrence.count) return
  }
}

function startDateOf(s: Schedule): string {
  return s.allDay ? s.startDate! : toZoned(s.startAt!, s.timezone).date
}

/** 원래 규칙대로 만든 회차(변경 적용 전) */
function baseOccurrence(s: MockSchedule, date: string): Occurrence {
  const common = {
    scheduleId: s.id,
    recurring: !!s.recurrence,
    modified: false,
    title: s.title,
    allDay: s.allDay,
    taskId: s.taskId ?? null,
    memo: s.memo ?? null,
    version: s.version,
  }
  if (s.allDay) {
    const span = diffDays(s.startDate!, s.endDate!)
    return {
      ...common,
      occurrenceStart: fromZoned(date, 0, s.timezone),
      startAt: null,
      endAt: null,
      startDate: date,
      endDate: addDays(date, span),
    }
  }
  const { minutes } = toZoned(s.startAt!, s.timezone)
  const duration = Date.parse(s.endAt!) - Date.parse(s.startAt!)
  const startAt = fromZoned(date, minutes, s.timezone)
  return {
    ...common,
    occurrenceStart: startAt,
    startAt,
    endAt: new Date(Date.parse(startAt) + duration).toISOString(),
    startDate: null,
    endDate: null,
  }
}

/** 업무 id → 프로젝트 id. 회차의 projectId는 연결된 업무의 프로젝트다(D-73) */
function taskProjects(): Map<string, string | null> {
  try {
    const tasks: { id: string; projectId?: string | null }[] =
      JSON.parse(localStorage.getItem(WORKLOG_STORE_KEY) ?? '{}').tasks ?? []
    return new Map(tasks.map((t) => [t.id, t.projectId ?? null]))
  } catch {
    return new Map()
  }
}

function withProject(o: Occurrence, projects: Map<string, string | null>): Occurrence {
  return { ...o, projectId: o.taskId ? (projects.get(o.taskId) ?? null) : null }
}

function applyOverride(o: Occurrence, override: Override | undefined): Occurrence | null {
  if (!override) return o
  if (override.deleted) return null
  const { deleted: _deleted, ...fields } = override
  return { ...o, ...fields, modified: true }
}

function bounds(o: Occurrence, timezone: string): [number, number] {
  if (!o.allDay) return [Date.parse(o.startAt!), Date.parse(o.endAt!)]
  return [Date.parse(fromZoned(o.startDate!, 0, timezone)), Date.parse(fromZoned(addDays(o.endDate!, 1), 0, timezone))]
}

function expand(s: MockSchedule, from: number, to: number): Occurrence[] {
  const result: Occurrence[] = []
  // 옮긴 회차가 원래 자리보다 멀리 갈 수 있으니 회차 키 기준으로 넉넉히(1년) 더 본다.
  const keyLimit = to + 366 * 86_400_000
  for (const date of seriesDates(startDateOf(s), s.recurrence)) {
    const base = baseOccurrence(s, date)
    if (Date.parse(base.occurrenceStart) >= keyLimit) break
    const o = applyOverride(base, s.overrides[base.occurrenceStart])
    if (!o) continue
    const [start, end] = bounds(o, s.timezone)
    if (start < to && end > from) result.push(o)
  }
  return result
}

function isSeriesKey(s: MockSchedule, key: string): boolean {
  const limit = Date.parse(key)
  for (const date of seriesDates(startDateOf(s), s.recurrence)) {
    const k = baseOccurrence(s, date).occurrenceStart
    if (k === key) return true
    if (Date.parse(k) > limit) return false
  }
  return false
}

// ── 검증

type FieldError = { field: string; code: string }

function validate(s: Schedule): FieldError[] {
  const errors: FieldError[] = []
  const title = s.title?.trim() ?? ''
  if (!title) errors.push({ field: 'title', code: 'REQUIRED' })
  else if (title.length > 200) errors.push({ field: 'title', code: 'TOO_LONG' })
  if (s.allDay) {
    if (!s.startDate) errors.push({ field: 'startDate', code: 'REQUIRED' })
    if (!s.endDate) errors.push({ field: 'endDate', code: 'REQUIRED' })
    if (s.startDate && s.endDate && s.endDate < s.startDate) errors.push({ field: 'endDate', code: 'OUT_OF_RANGE' })
  } else {
    if (!s.startAt) errors.push({ field: 'startAt', code: 'REQUIRED' })
    if (!s.endAt) errors.push({ field: 'endAt', code: 'REQUIRED' })
    if (s.startAt && s.endAt && Date.parse(s.endAt) <= Date.parse(s.startAt))
      errors.push({ field: 'endAt', code: 'OUT_OF_RANGE' })
  }
  const r = s.recurrence
  if (r && errors.length === 0) {
    const start = startDateOf(s)
    if (r.until && r.count) errors.push({ field: 'recurrence', code: 'INVALID_FORMAT' })
    if (r.until && r.until < start) errors.push({ field: 'recurrence.until', code: 'OUT_OF_RANGE' })
    if (r.frequency === 'WEEKLY' && !(r.weekdays ?? []).includes(WEEKDAYS[weekdayIndex(start)]))
      errors.push({ field: 'recurrence.weekdays', code: 'OUT_OF_RANGE' })
  }
  return errors
}

const TIME_FIELDS = ['allDay', 'startAt', 'endAt', 'startDate', 'endDate', 'recurrence'] as const
const PATCH_FIELDS = [...TIME_FIELDS, 'title', 'taskId', 'memo'] as const

function publicSchedule({ overrides: _overrides, ...s }: MockSchedule): Schedule {
  return s
}

/** 일정이 연결된 업무 id. 가짜 업무 서버(mockWorklog)가 Task.hasSchedule을 계산할 때 쓴다 */
export function scheduledTaskIds(): Set<string> {
  return new Set(load().flatMap((s) => (s.taskId ? [s.taskId] : [])))
}

// ── 요청 처리

/** 처리한 요청이면 응답, 아니면 null */
export function handleScheduleMock(
  method: string,
  url: string,
  body: Record<string, unknown>,
  r: Respond,
): Response | null {
  const [path, query = ''] = url.split('?')
  if (!path.startsWith('/api/worklog/schedules')) return null
  const state = load()
  const invalid = (errors: FieldError[]) => r.problem(400, 'VALIDATION_FAILED', { errors })

  if (path === '/api/worklog/schedules') {
    if (method === 'GET') {
      const params = new URLSearchParams(query)
      const from = Date.parse(params.get('from') ?? '')
      const to = Date.parse(params.get('to') ?? '')
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > 400 * 86_400_000)
        return invalid([{ field: 'to', code: 'OUT_OF_RANGE' }])
      const projects = taskProjects()
      const items = state
        .flatMap((s) => expand(s, from, to))
        .map((o) => withProject(o, projects))
        .sort((a, b) => bounds(a, 'UTC')[0] - bounds(b, 'UTC')[0] || a.title.localeCompare(b.title))
      return r.json(200, { items })
    }
    if (method === 'POST') {
      const created = schedule(newId(), String(body.title ?? '').trim(), browserZone(), {})
      for (const field of PATCH_FIELDS) if (field in body) Object.assign(created, { [field]: body[field] })
      created.title = String(created.title ?? '').trim()
      const errors = validate(created)
      if (errors.length) return invalid(errors)
      state.push(created)
      save(state)
      return r.json(201, publicSchedule(created))
    }
    return null
  }

  const occurrenceMatch = /^\/api\/worklog\/schedules\/([^/]+)\/occurrences\/([^/]+)$/.exec(path)
  if (occurrenceMatch) {
    const s = state.find((x) => x.id === occurrenceMatch[1])
    const key = new Date(decodeURIComponent(occurrenceMatch[2])).toISOString()
    if (!s) return r.problem(404, 'NOT_FOUND')
    if (!s.recurrence) return r.problem(409, 'NOT_RECURRING')
    if (method === 'DELETE') {
      if (!isSeriesKey(s, key)) return r.problem(404, 'NOT_FOUND')
      s.overrides[key] = { ...s.overrides[key], deleted: true }
      s.version++
      save(state)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      if (!isSeriesKey(s, key) || s.overrides[key]?.deleted) return r.problem(404, 'NOT_FOUND')
      if (body.version !== s.version) return r.problem(409, 'VERSION_CONFLICT')
      const patch = body as OccurrencePatch
      const override: Override = { ...s.overrides[key] }
      for (const field of ['title', 'memo', 'startAt', 'endAt', 'startDate', 'endDate'] as const)
        if (field in patch) Object.assign(override, { [field]: patch[field] })
      const date = toZoned(key, s.timezone).date
      const result = applyOverride(baseOccurrence(s, date), override)!
      const errors = validate({ ...publicSchedule(s), ...result, recurrence: null })
      if (errors.length) return invalid(errors)
      s.overrides[key] = override
      s.version++
      save(state)
      return r.json(200, { ...withProject(result, taskProjects()), version: s.version })
    }
    return null
  }

  const scheduleMatch = /^\/api\/worklog\/schedules\/([^/]+)$/.exec(path)
  if (scheduleMatch) {
    const index = state.findIndex((x) => x.id === scheduleMatch[1])
    if (index < 0) return r.problem(404, 'NOT_FOUND')
    const s = state[index]
    if (method === 'GET') return r.json(200, publicSchedule(s))
    if (method === 'DELETE') {
      state.splice(index, 1)
      save(state)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      if (body.version !== s.version) return r.problem(409, 'VERSION_CONFLICT')
      const next: MockSchedule = { ...s }
      for (const field of PATCH_FIELDS) if (field in body) Object.assign(next, { [field]: body[field] })
      if (typeof next.title === 'string') next.title = next.title.trim()
      if ('allDay' in body && body.allDay !== s.allDay) {
        // 종일 여부를 바꾸면 이전 종류의 시각 칸은 비운다
        if (next.allDay) Object.assign(next, { startAt: null, endAt: null })
        else Object.assign(next, { startDate: null, endDate: null })
      }
      const errors = validate(next)
      if (errors.length) return invalid(errors)
      if (TIME_FIELDS.some((f) => f in body)) next.overrides = {}
      next.version = s.version + 1
      next.updatedAt = now()
      state[index] = next
      save(state)
      return r.json(200, publicSchedule(next))
    }
  }
  return null
}

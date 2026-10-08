// 개발용 가짜 일지 서버 (contracts/worklog.yaml logs, D-107·D-108). mockWorklog가 기록·업무 상태와 함께 넘긴다.
// 서버 생성 규칙을 줄여 옮겼다: 실적 = 그날 확정 기록 + 기록 없이 완료한 업무, 자동 상태면 읽을 때마다 다시 만든다.
// 근무일은 프로필 업무 요일 + 공휴일. 소요시간 표(time)는 만들지 않는다(null).
import { holidayName } from '../calendar/holidays'
import { addDays, isoWeekday } from '../quickInput/dates'
import type { Project } from '../projects/api'
import type { WorkRecord } from '../records/api'
import type { Task } from '../tasks/api'
import type {
  CarryOverCandidate,
  DailyClosePlan,
  LogAchievement,
  LogContent,
  LogPeriod,
  LogPlan,
  LogRevisionDetail,
  LogStatus,
  LogSuggestion,
  LogType,
  PlanCandidate,
  WorkLog,
} from './api'
import { isWorkday } from './api'

export interface StoredLog {
  id: string
  type: LogType
  periodStart: string
  status: 'DRAFT' | 'CONFIRMED'
  version: number
  achievementsAuto: boolean
  achievements: LogAchievement[]
  plans: LogPlan[]
  issues: string | null
  confirmedAt: string | null
  /** 확정 때 내용 */
  snapshot: LogContent | null
  revisions: LogRevisionDetail[]
}

export interface LogsMockContext {
  records: WorkRecord[]
  tasks: Task[]
  projects: Project[]
  logs: StoredLog[]
  today: string
  author: { name: string | null; organization: string | null; position: string | null }
  workDays: number
  /** 주 시작 요일(월=1 … 일=7) */
  weekStart: number
  save: () => void
}

type Respond = {
  json: (status: number, body: unknown) => Response
  problem: (status: number, code: string, extra?: Record<string, unknown>) => Response
}

const TYPES: Record<string, LogType> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }
const TITLES: Record<LogType, string> = { DAILY: '업무일지', WEEKLY: '주간 업무일지', MONTHLY: '월간 업무일지' }
const now = () => new Date().toISOString()
const uid = () => `mock-log-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
const seoulDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso))

function workday(ctx: LogsMockContext, date: string) {
  return isWorkday(date, ctx.workDays, holidayName(date))
}

function nextWorkday(ctx: LogsMockContext, date: string) {
  let d = addDays(date, 1)
  for (let i = 0; i < 14 && !workday(ctx, d); i++) d = addDays(d, 1)
  return d
}

/** 주 시작 월요일(mock 고정) */
const weekStartOf = (ctx: LogsMockContext, date: string) => addDays(date, -((isoWeekday(date) - ctx.weekStart + 7) % 7))
const monthEnd = (start: string) => {
  const [y, m] = start.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function periodEnd(type: LogType, start: string) {
  if (type === 'DAILY') return start
  if (type === 'WEEKLY') return addDays(start, 6)
  return monthEnd(start)
}

function eachDay(from: string, to: string) {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  return days
}

function dayRecords(ctx: LogsMockContext, date: string, status: WorkRecord['status'] = 'CONFIRMED') {
  return ctx.records.filter(
    (r) => !r.deletedAt && r.workDate === date && r.status === status && !(r.startAt && !r.endAt),
  )
}

function completedOn(ctx: LogsMockContext, date: string) {
  return ctx.tasks.filter(
    (t) => !t.deletedAt && t.status === 'DONE' && t.completedAt && seoulDate(t.completedAt) === date,
  )
}

const projectName = (ctx: LogsMockContext, taskId: string | null) => {
  const task = ctx.tasks.find((t) => t.id === taskId)
  return ctx.projects.find((p) => p.id === task?.projectId)?.name ?? null
}

function dailyAchievements(ctx: LogsMockContext, date: string): LogAchievement[] {
  const records = dayRecords(ctx, date)
  const fromRecords = records.map<LogAchievement>((r) => ({
    id: `a-${r.id}`,
    source: 'RECORD',
    text: r.content,
    result: r.result ?? null,
    outcome: r.outcome ?? null,
    progress: r.progress ?? null,
    taskId: r.taskId ?? null,
    projectName: projectName(ctx, r.taskId ?? null),
    recordIds: [r.id],
    dates: [date],
    durationMin: null,
  }))
  const recorded = new Set(records.map((r) => r.taskId))
  const fromTasks = completedOn(ctx, date)
    .filter((t) => !recorded.has(t.id))
    .map<LogAchievement>((t) => ({
      id: `a-task-${t.id}`,
      source: 'TASK',
      text: t.title,
      result: null,
      outcome: 'DONE',
      progress: 100,
      taskId: t.id,
      projectName: projectName(ctx, t.id),
      recordIds: [],
      dates: [date],
      durationMin: null,
    }))
  return [...fromRecords, ...fromTasks]
}

/** 주간·월간: 날마다 확정 일간이 있으면 그 실적, 없으면 원본. 업무별로 묶는다 */
function groupedAchievements(ctx: LogsMockContext, days: string[]): LogAchievement[] {
  const rows: LogAchievement[] = []
  for (const date of days) {
    const confirmed = ctx.logs.find((l) => l.type === 'DAILY' && l.periodStart === date && l.status === 'CONFIRMED')
    const list = confirmed?.snapshot?.achievements ?? dailyAchievements(ctx, date)
    for (const a of list) {
      const same = a.taskId && rows.find((x) => x.taskId === a.taskId)
      if (same) {
        Object.assign(same, {
          result: a.result ?? same.result,
          outcome: a.outcome ?? same.outcome,
          progress: a.progress ?? same.progress,
          recordIds: [...same.recordIds, ...a.recordIds],
          dates: same.dates.includes(date) ? same.dates : [...same.dates, date],
        })
      } else rows.push({ ...a, id: `g-${a.id}`, dates: [date] })
    }
  }
  return rows
}

function sourceDays(ctx: LogsMockContext, start: string, end: string) {
  return eachDay(start, end).map((date) => {
    const confirmed = ctx.logs.some((l) => l.type === 'DAILY' && l.periodStart === date && l.status === 'CONFIRMED')
    const has = dayRecords(ctx, date).length > 0 || completedOn(ctx, date).length > 0
    return {
      date,
      holiday: holidayName(date) ?? null,
      workday: workday(ctx, date),
      source: confirmed ? ('CONFIRMED_LOG' as const) : has ? ('RECORDS' as const) : ('NONE' as const),
    }
  })
}

function planPeriodOf(ctx: LogsMockContext, type: LogType, start: string, end: string) {
  if (type === 'DAILY') {
    const next = nextWorkday(ctx, start)
    const nextWeek = weekStartOf(ctx, next) !== weekStartOf(ctx, start)
    return { title: nextWeek ? '다음 주 계획' : '다음 근무일 계획', period: { start: next, end: next } }
  }
  if (type === 'WEEKLY') return { title: '다음 주 계획', period: { start: addDays(end, 1), end: addDays(end, 7) } }
  const s = addDays(end, 1)
  return { title: '다음 달 계획', period: { start: s, end: monthEnd(s) } }
}

function candidatesOf(ctx: LogsMockContext, start: string, planEnd: string, plans: LogPlan[]): PlanCandidate[] {
  const taken = new Set(plans.map((p) => p.taskId))
  return ctx.tasks
    .filter((t) => !t.deletedAt && t.status !== 'DONE' && t.status !== 'ON_HOLD' && !taken.has(t.id))
    .map((t) => {
      const reason =
        t.dueDate && t.dueDate < start
          ? ('OVERDUE' as const)
          : t.status === 'IN_PROGRESS'
            ? ('IN_PROGRESS' as const)
            : t.dueDate && t.dueDate <= planEnd
              ? ('DUE' as const)
              : null
      return (
        reason && {
          taskId: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate ?? null,
          progress: t.progress,
          reason,
        }
      )
    })
    .filter((c): c is PlanCandidate => Boolean(c))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title))
    .slice(0, 20)
}

function fillPlan(ctx: LogsMockContext, p: LogPlan): LogPlan {
  const task = ctx.tasks.find((t) => t.id === p.taskId)
  return { ...p, dueDate: task?.dueDate ?? null, scheduledAt: null }
}

function build(ctx: LogsMockContext, type: LogType, start: string, stored: StoredLog | undefined): WorkLog {
  const end = periodEnd(type, start)
  if (stored?.status === 'CONFIRMED' && stored.snapshot) {
    return {
      id: stored.id,
      type,
      periodStart: start,
      periodEnd: end,
      status: 'CONFIRMED',
      version: stored.version,
      confirmedAt: stored.confirmedAt,
      content: stored.snapshot,
      planCandidates: [],
      sourceChangedAfterConfirm: false,
    }
  }
  const days = eachDay(start, end)
  const auto = stored ? stored.achievementsAuto : true
  const generated = type === 'DAILY' ? dailyAchievements(ctx, start) : groupedAchievements(ctx, days)
  const achievements = auto ? generated : stored!.achievements
  const records = days.flatMap((d) => dayRecords(ctx, d))
  const pendingCount = days.flatMap((d) => dayRecords(ctx, d, 'PENDING')).length
  const completed = days.flatMap((d) => completedOn(ctx, d))
  const { title: planTitle, period } = planPeriodOf(ctx, type, start, end)
  const plans = (stored?.plans ?? []).map((p) => fillPlan(ctx, p))
  const status: LogStatus = stored ? 'DRAFT' : generated.length > 0 || pendingCount > 0 ? 'NOT_WRITTEN' : 'NO_RECORDS'
  const projectStats =
    type === 'MONTHLY'
      ? // 서버처럼 기록과 완료한 업무 모두에서 프로젝트를 모은다. 이름순, '프로젝트 없음'은 끝
        [
          ...new Set([
            ...records.map((r) => projectName(ctx, r.taskId ?? null)),
            ...completed.map((t) => projectName(ctx, t.id)),
          ]),
        ]
          .sort((a, b) => (a == null ? 1 : b == null ? -1 : a.localeCompare(b)))
          .map((name) => ({
            projectId: ctx.projects.find((p) => p.name === name)?.id ?? null,
            name,
            completedTaskCount: completed.filter((t) => projectName(ctx, t.id) === name).length,
            recordCount: records.filter((r) => projectName(ctx, r.taskId ?? null) === name).length,
            minutes: null,
          }))
      : []
  return {
    id: stored?.id ?? null,
    type,
    periodStart: start,
    periodEnd: end,
    status,
    version: stored?.version ?? 0,
    confirmedAt: null,
    sourceChangedAfterConfirm: false,
    planCandidates: candidatesOf(ctx, start, period.end, plans),
    content: {
      title: TITLES[type],
      author: ctx.author,
      achievements,
      achievementsAuto: auto,
      metrics: {
        completedTaskCount: completed.length,
        recordCount: records.length,
        // 서버 규칙(d8ecdea): '완료' 기록 수 + 완료한 날 그 업무의 기록이 없는 업무 수
        done:
          records.filter((r) => r.outcome === 'DONE').length +
          days
            .flatMap((d) => completedOn(ctx, d).map((t) => ({ t, d })))
            .filter(({ t, d }) => !dayRecords(ctx, d).some((r) => r.taskId === t.id)).length,
        inProgress: records.filter((r) => r.outcome === 'IN_PROGRESS').length,
        reviewRequested: records.filter((r) => r.outcome === 'REVIEW_REQUESTED').length,
        pendingCount,
        totalMin: null,
      },
      planTitle,
      planPeriod: period,
      plans,
      issues: stored?.issues ?? null,
      days: type === 'DAILY' ? [] : sourceDays(ctx, start, end),
      projects: projectStats,
      time: null,
    },
  }
}

function periodRow(ctx: LogsMockContext, type: LogType, start: string): LogPeriod {
  const stored = ctx.logs.find((l) => l.type === type && l.periodStart === start)
  const log = build(ctx, type, start, stored)
  const row: LogPeriod = { type, periodStart: start, periodEnd: log.periodEnd, status: log.status, logId: log.id }
  if (start > ctx.today) row.status = stored ? row.status : 'NO_RECORDS'
  if (type === 'DAILY') return { ...row, workday: workday(ctx, start), holiday: holidayName(start) ?? null }
  const days = sourceDays(ctx, start, log.periodEnd)
  return {
    ...row,
    days: {
      workdays: days.filter((d) => d.workday).length,
      confirmed: days.filter((d) => d.source === 'CONFIRMED_LOG').length,
    },
  }
}

function periodsBetween(ctx: LogsMockContext, type: LogType, from: string, to: string) {
  if (type === 'DAILY') return eachDay(from, to)
  const starts: string[] = []
  if (type === 'WEEKLY') for (let s = weekStartOf(ctx, from); s <= to; s = addDays(s, 7)) starts.push(s)
  else for (let s = `${from.slice(0, 7)}-01`; s <= to; s = addDays(monthEnd(s), 1)) starts.push(s)
  return starts
}

function suggestionsAfter(ctx: LogsMockContext, date: string): LogSuggestion[] {
  if (!workday(ctx, date)) return []
  const out: LogSuggestion[] = []
  const lastOfWeek = weekStartOf(ctx, nextWorkday(ctx, date)) !== weekStartOf(ctx, date)
  const lastOfMonth = nextWorkday(ctx, date).slice(0, 7) !== date.slice(0, 7)
  const add = (type: LogType, start: string) => {
    const row = periodRow(ctx, type, start)
    const unconfirmedDates = sourceDays(ctx, start, row.periodEnd)
      .filter((d) => d.workday && d.source !== 'CONFIRMED_LOG' && d.date !== date)
      .map((d) => d.date)
    out.push({
      type: type as 'WEEKLY' | 'MONTHLY',
      periodStart: start,
      periodEnd: row.periodEnd,
      logStatus: row.status,
      unconfirmedDates,
    })
  }
  if (lastOfWeek) add('WEEKLY', weekStartOf(ctx, date))
  if (lastOfMonth) add('MONTHLY', `${date.slice(0, 7)}-01`)
  return out
}

function confirm(ctx: LogsMockContext, stored: StoredLog) {
  const content = build(ctx, stored.type, stored.periodStart, stored).content
  stored.snapshot = { ...content, achievementsAuto: false }
  stored.achievements = content.achievements
  stored.achievementsAuto = false
  stored.status = 'CONFIRMED'
  stored.confirmedAt = now()
  stored.version += 1
  stored.revisions.unshift({
    revisionNo: stored.revisions.length + 1,
    confirmedAt: stored.confirmedAt,
    unconfirmedAt: null,
    content: stored.snapshot,
  })
}

function newLog(type: LogType, start: string): StoredLog {
  return {
    id: uid(),
    type,
    periodStart: start,
    status: 'DRAFT',
    version: 0,
    achievementsAuto: true,
    achievements: [],
    plans: [],
    issues: null,
    confirmedAt: null,
    snapshot: null,
    revisions: [],
  }
}

/** 처리한 요청이면 응답, 아니면 null */
export function handleLogsMock(
  method: string,
  url: string,
  body: Record<string, unknown>,
  ctx: LogsMockContext,
  r: Respond,
): Response | null {
  const path = url.split('?')[0]
  if (!path.startsWith('/api/worklog/logs')) return null
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const out = (stored: StoredLog) => build(ctx, stored.type, stored.periodStart, stored)

  if (method === 'GET' && path === '/api/worklog/logs') {
    const type = (q.get('type') ?? 'DAILY') as LogType
    const from = q.get('from') ?? ctx.today
    const to = q.get('to') ?? ctx.today
    const items = periodsBetween(ctx, type, from, to).map((s) => periodRow(ctx, type, s))
    const unconfirmedDays = eachDay(from, to < ctx.today ? to : ctx.today).filter((d) => {
      const row = periodRow(ctx, 'DAILY', d)
      return row.status === 'NOT_WRITTEN' || row.status === 'DRAFT'
    }).length
    return r.json(200, { items, unconfirmedDays })
  }

  const close = /^\/api\/worklog\/logs\/daily\/(\d{4}-\d{2}-\d{2})\/close$/.exec(path)
  if (close) {
    const date = close[1]
    if (date > ctx.today)
      return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'date', code: 'OUT_OF_RANGE' }] })
    const stored = ctx.logs.find((l) => l.type === 'DAILY' && l.periodStart === date)
    if (method === 'GET') {
      const next = nextWorkday(ctx, date)
      const candidates: CarryOverCandidate[] = ctx.tasks
        .filter((t) => !t.deletedAt && (t.status === 'TODO' || t.status === 'IN_PROGRESS'))
        .filter(
          (t) =>
            t.status === 'IN_PROGRESS' ||
            (t.dueDate != null && t.dueDate <= next) ||
            dayRecords(ctx, date).some((x) => x.taskId === t.id),
        )
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title))
        .map((t) => ({
          taskId: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate ?? null,
          progress: t.progress,
          projectId: t.projectId ?? null,
          selected: true,
        }))
      const plan: DailyClosePlan = {
        date,
        log: periodRow(ctx, 'DAILY', date),
        pendingCount: ctx.records.filter(
          (x) => x.status === 'PENDING' && !x.deletedAt && x.workDate >= addDays(ctx.today, -6),
        ).length,
        carryOverCandidates: candidates,
        nextWorkday: next,
        planScope: weekStartOf(ctx, next) !== weekStartOf(ctx, date) ? 'NEXT_WEEK' : 'NEXT_WORKDAY',
        suggestions: suggestionsAfter(ctx, date),
      }
      return r.json(200, plan)
    }
    if (method === 'POST') {
      if (stored?.status === 'CONFIRMED') return r.problem(409, 'LOG_CONFIRMED')
      if ((stored?.version ?? 0) !== body.version) return r.problem(409, 'VERSION_CONFLICT')
      const ids = (body.carryOverTaskIds as string[]) ?? []
      const plans = stored?.plans ?? []
      if (ids.some((taskId) => !ctx.tasks.some((t) => t.id === taskId && !t.deletedAt)))
        return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'carryOverTaskIds', code: 'NOT_FOUND' }] })
      // 서버와 같은 상한: 계획 50줄, 이슈 2000자(덧붙인 뒤 기준). 어기면 아무것도 바꾸지 않는다
      if (plans.length + new Set(ids.filter((id) => !plans.some((p) => p.taskId === id))).size > 50)
        return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'carryOverTaskIds', code: 'TOO_MANY' }] })
      const issue = typeof body.issue === 'string' ? body.issue.trim() : ''
      const issues = issue ? (stored?.issues ? `${stored.issues}\n${issue}` : issue) : (stored?.issues ?? null)
      if ((issues?.length ?? 0) > 2000)
        return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'issue', code: 'TOO_LONG' }] })
      const log = stored ?? newLog('DAILY', date)
      if (!stored) ctx.logs.push(log)
      for (const taskId of ids) {
        const task = ctx.tasks.find((t) => t.id === taskId)!
        if (!log.plans.some((p) => p.taskId === taskId))
          log.plans.push({ id: uid(), taskId, text: task.title, dueDate: null, scheduledAt: null })
      }
      log.issues = issues
      confirm(ctx, log)
      ctx.save()
      return r.json(200, { log: out(log), suggestions: suggestionsAfter(ctx, date) })
    }
  }

  const byPeriod = /^\/api\/worklog\/logs\/(daily|weekly|monthly)\/(\d{4}-\d{2}-\d{2})$/.exec(path)
  if (byPeriod) {
    const type = TYPES[byPeriod[1]]
    const start = byPeriod[2]
    const stored = ctx.logs.find((l) => l.type === type && l.periodStart === start)
    if (method === 'GET') return r.json(200, build(ctx, type, start, stored))
    if (method === 'POST') {
      if (stored) return r.json(200, out(stored))
      if (start > ctx.today)
        return r.problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'periodStart', code: 'OUT_OF_RANGE' }] })
      const log = newLog(type, start)
      ctx.logs.push(log)
      ctx.save()
      return r.json(201, out(log))
    }
  }

  const byId = /^\/api\/worklog\/logs\/([^/]+)(?:\/(refill|confirm|unconfirm|revisions))?(?:\/(\d+))?$/.exec(path)
  if (byId) {
    const stored = ctx.logs.find((l) => l.id === byId[1])
    if (!stored) return r.problem(404, 'NOT_FOUND')
    const action = byId[2]
    if (method === 'GET' && action === 'revisions') {
      if (byId[3]) {
        const rev = stored.revisions.find((x) => x.revisionNo === Number(byId[3]))
        return rev ? r.json(200, rev) : r.problem(404, 'NOT_FOUND')
      }
      return r.json(200, { items: stored.revisions.map((rev) => ({ ...rev, content: undefined })) })
    }
    if (method !== 'PATCH' && method !== 'POST') return null
    if (body.version !== stored.version) return r.problem(409, 'VERSION_CONFLICT')
    if (action === 'unconfirm') {
      if (stored.status !== 'CONFIRMED') return r.problem(409, 'LOG_NOT_CONFIRMED')
      stored.status = 'DRAFT'
      stored.achievementsAuto = false
      stored.achievements = stored.snapshot?.achievements ?? stored.achievements
      stored.plans = stored.snapshot?.plans ?? stored.plans
      stored.issues = stored.snapshot?.issues ?? stored.issues
      stored.snapshot = null
      stored.confirmedAt = null
      if (stored.revisions[0]) stored.revisions[0].unconfirmedAt = now()
      stored.version += 1
      ctx.save()
      return r.json(200, out(stored))
    }
    if (stored.status === 'CONFIRMED') return r.problem(409, 'LOG_CONFIRMED')
    if (action === 'confirm') confirm(ctx, stored)
    else if (action === 'refill') {
      stored.achievementsAuto = true
      stored.version += 1
    } else if (method === 'PATCH') {
      if (Array.isArray(body.achievements)) {
        stored.achievements = body.achievements as LogAchievement[]
        stored.achievementsAuto = false
      }
      if (Array.isArray(body.plans)) stored.plans = body.plans as LogPlan[]
      if ('issues' in body) stored.issues = (body.issues as string | null) || null
      stored.version += 1
    }
    ctx.save()
    return r.json(200, out(stored))
  }
  return null
}

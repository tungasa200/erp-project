// 개발용 가짜 통계 API (contracts/worklog.yaml 0.6.0 GET /stats·/stats/plan-vs-actual, P4-02). 시간대는 서울로 고정한다.
// mockWorklog가 업무·기록·일지·회차를 넘겨 주고, 숫자 규칙은 계약 description을 따른다.
import type { Occurrence } from '../calendar/api'
import type { StoredLog } from '../logs/mockLogs'
import type { WorkRecord } from '../records/api'
import type { Task } from '../tasks/api'

interface StatsContext {
  tasks: Task[]
  records: WorkRecord[]
  logs: StoredLog[]
  /** 주 시작 요일(월=1 … 일=7) */
  weekStart: number
  occurrencesBetween: (fromIso: string, toIso: string) => Occurrence[]
}

type Respond = {
  json: (status: number, body: unknown) => Response
  problem: (status: number, code: string, extra?: Record<string, unknown>) => Response
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const seoulDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
/** date가 속한 주의 시작일 */
function weekStartOf(date: string, weekStart: number) {
  const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 // 월=1 … 일=7
  return addDays(date, -((iso - weekStart + 7) % 7))
}

export function handleStatsMock(method: string, url: string, ctx: StatsContext, r: Respond): Response | null {
  const path = url.split('?')[0]
  if (method !== 'GET' || (path !== '/api/worklog/stats' && path !== '/api/worklog/stats/plan-vs-actual')) return null
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const from = q.get('from') ?? ''
  const to = q.get('to') ?? ''
  const errors = [
    ...(DATE.test(from) ? [] : [{ field: 'from', code: 'REQUIRED' }]),
    ...(DATE.test(to) ? [] : [{ field: 'to', code: 'REQUIRED' }]),
  ]
  if (!errors.length && from > to) errors.push({ field: 'to', code: 'OUT_OF_RANGE' })
  if (!errors.length && daysBetween(from, to) + 1 > 400) errors.push({ field: 'to', code: 'OUT_OF_RANGE' })
  if (errors.length) return r.problem(400, 'VALIDATION_FAILED', { errors })

  const inRange = (date: string) => date >= from && date <= to
  const liveTasks = ctx.tasks.filter((t) => !t.deletedAt)
  const confirmed = ctx.records.filter((x) => !x.deletedAt && x.status === 'CONFIRMED')
  const taskOf = (id: string | null | undefined) => ctx.tasks.find((t) => t.id === id)

  if (path === '/api/worklog/stats') {
    const completed = liveTasks.filter((t) => t.status === 'DONE' && t.completedAt && inRange(seoulDate(t.completedAt)))
    const records = confirmed.filter((x) => inRange(x.workDate))
    const daily = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => {
      const date = addDays(from, i)
      return {
        date,
        completedTaskCount: completed.filter((t) => seoulDate(t.completedAt!) === date).length,
        recordCount: records.filter((x) => x.workDate === date).length,
      }
    })
    const byProject = new Map<string | null, { completedTaskCount: number; recordCount: number }>()
    const bump = (projectId: string | null, key: 'completedTaskCount' | 'recordCount') => {
      const row = byProject.get(projectId) ?? { completedTaskCount: 0, recordCount: 0 }
      row[key] += 1
      byProject.set(projectId, row)
    }
    for (const t of completed) bump(t.projectId ?? null, 'completedTaskCount')
    for (const x of records) bump(taskOf(x.taskId)?.projectId ?? null, 'recordCount')
    const projects = [...byProject.entries()]
      .map(([projectId, row]) => ({ projectId, ...row }))
      .sort(
        (a, b) =>
          b.completedTaskCount - a.completedTaskCount ||
          b.recordCount - a.recordCount ||
          String(a.projectId).localeCompare(String(b.projectId)),
      )
    const first = confirmed.map((x) => x.workDate).sort()[0] ?? null
    return r.json(200, {
      from,
      to,
      completedTaskCount: completed.length,
      recordCount: records.length,
      confirmedLogCount: ctx.logs.filter((l) => l.status === 'CONFIRMED' && inRange(l.periodStart)).length,
      daily,
      projects,
      firstRecordDate: first,
    })
  }

  // 예상 대비 실제: 업무에 연결된 시간 일정 회차 길이 vs 확정 기록 durationMin
  const plannedByWeek = new Map<string, Map<string, number>>() // 주 → 업무 → 분
  const occurrences = ctx.occurrencesBetween(
    new Date(`${from}T00:00:00+09:00`).toISOString(),
    new Date(`${addDays(to, 1)}T00:00:00+09:00`).toISOString(),
  )
  for (const o of occurrences) {
    if (o.allDay || !o.taskId || !o.startAt || !o.endAt) continue
    const date = seoulDate(o.startAt)
    if (!inRange(date)) continue
    const week = weekStartOf(date, ctx.weekStart)
    const tasks = plannedByWeek.get(week) ?? new Map<string, number>()
    tasks.set(o.taskId, (tasks.get(o.taskId) ?? 0) + Math.round((Date.parse(o.endAt) - Date.parse(o.startAt)) / 60_000))
    plannedByWeek.set(week, tasks)
  }
  const actualByWeek = new Map<string, Map<string | null, number>>()
  for (const x of confirmed) {
    if (!inRange(x.workDate) || !x.durationMin) continue
    const week = weekStartOf(x.workDate, ctx.weekStart)
    const tasks = actualByWeek.get(week) ?? new Map<string | null, number>()
    tasks.set(x.taskId ?? null, (tasks.get(x.taskId ?? null) ?? 0) + x.durationMin)
    actualByWeek.set(week, tasks)
  }
  const weeks: { weekStart: string; plannedMin: number; actualMin: number; unplannedMin: number }[] = []
  for (let week = weekStartOf(from, ctx.weekStart); week <= to; week = addDays(week, 7)) {
    const planned = plannedByWeek.get(week) ?? new Map<string, number>()
    let actualMin = 0
    let unplannedMin = 0
    for (const [taskId, min] of actualByWeek.get(week) ?? []) {
      if (taskId && planned.has(taskId)) actualMin += min
      else unplannedMin += min
    }
    weeks.push({
      weekStart: week,
      plannedMin: [...planned.values()].reduce((a, b) => a + b, 0),
      actualMin,
      unplannedMin,
    })
  }
  const totals = new Map<string, { plannedMin: number; actualMin: number }>()
  for (const tasks of plannedByWeek.values())
    for (const [taskId, min] of tasks) {
      const row = totals.get(taskId) ?? { plannedMin: 0, actualMin: 0 }
      row.plannedMin += min
      totals.set(taskId, row)
    }
  for (const x of confirmed) {
    if (!inRange(x.workDate) || !x.durationMin || !x.taskId) continue
    const row = totals.get(x.taskId)
    if (row) row.actualMin += x.durationMin
  }
  const topDiffs = [...totals.entries()]
    .map(([taskId, row]) => ({
      taskId,
      title: taskOf(taskId)?.title ?? '',
      projectId: taskOf(taskId)?.projectId ?? null,
      ...row,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.actualMin - b.plannedMin) - Math.abs(a.actualMin - a.plannedMin) || a.taskId.localeCompare(b.taskId),
    )
    .slice(0, 5)
  return r.json(200, { from, to, weeks, topDiffs })
}

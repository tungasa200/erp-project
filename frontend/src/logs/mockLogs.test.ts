// 가짜 일지 서버가 실제 서버 규칙을 따르는지: 진행 현황 '완료'(d8ecdea), 월간 프로젝트별 표, 하루 마감 상한(계획 50·이슈 2000자)
import { describe, expect, it } from 'vitest'
import { handleLogsMock, type LogsMockContext, type StoredLog } from './mockLogs'

const r = {
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
  problem: (status: number, code: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ code, ...extra }), { status }),
}

const record = (id: string, workDate: string, taskId: string | null, outcome: string | null) => ({
  id,
  workDate,
  taskId,
  outcome,
  content: id,
  status: 'CONFIRMED',
  deletedAt: null,
  startAt: null,
  endAt: null,
})

const task = (id: string, projectId: string | null, completedAt: string | null) => ({
  id,
  title: id,
  projectId,
  status: completedAt ? 'DONE' : 'IN_PROGRESS',
  completedAt,
  deletedAt: null,
  dueDate: null,
  progress: completedAt ? 100 : 50,
})

function context(extra: Partial<LogsMockContext> = {}): LogsMockContext {
  return {
    // 월 10/5: t-rec는 그날 '완료' 기록과 함께 완료, t-alone은 기록 없이 완료(프로젝트 '영업'), 10/6 기록 하나는 '완료'(업무 없음)
    records: [record('r-1', '2026-10-05', 't-rec', 'DONE'), record('r-2', '2026-10-06', null, 'DONE')],
    tasks: [task('t-rec', 'p-dev', '2026-10-05T03:00:00Z'), task('t-alone', 'p-sales', '2026-10-05T05:00:00Z')],
    projects: [
      { id: 'p-dev', name: '개발' },
      { id: 'p-sales', name: '영업' },
    ],
    logs: [],
    today: '2026-10-08',
    author: { name: null, organization: null, position: null },
    workDays: 31,
    weekStart: 1,
    save: () => {},
    ...extra,
  } as unknown as LogsMockContext
}

const call = async (method: string, url: string, ctx: LogsMockContext, body: Record<string, unknown> = {}) => {
  const res = handleLogsMock(method, url, body, ctx, r)!
  return { status: res.status, body: await res.json() }
}

describe('가짜 일지 서버', () => {
  it("진행 현황 '완료' = 완료 기록 수 + 완료한 날 그 업무 기록이 없는 업무 수", async () => {
    const ctx = context()
    const day = await call('GET', '/api/worklog/logs/daily/2026-10-05', ctx)
    expect(day.body.content.metrics.done).toBe(2) // 기록 1 + t-alone(t-rec는 기록으로 이미 셈)
    const week = await call('GET', '/api/worklog/logs/weekly/2026-10-05', ctx)
    expect(week.body.content.metrics.done).toBe(3)
  })

  it('월간 프로젝트 표는 기록 없이 완료한 업무의 프로젝트도 넣고, 이름순·프로젝트 없음은 끝', async () => {
    const month = await call('GET', '/api/worklog/logs/monthly/2026-10-01', context())
    expect(
      month.body.content.projects.map((p: { name: string | null; completedTaskCount: number; recordCount: number }) => [
        p.name,
        p.completedTaskCount,
        p.recordCount,
      ]),
    ).toEqual([
      ['개발', 1, 1],
      ['영업', 1, 0],
      [null, 0, 1],
    ])
  })

  it('계획 후보 사유는 서버와 같다: 오늘보다 이른 마감은 마감 지남, 계획 기간 안 마감이 진행 중보다 먼저', async () => {
    const open = (id: string, dueDate: string | null) => ({ ...task(id, null, null), dueDate })
    const ctx = context({
      records: [],
      tasks: [open('지난', '2026-10-07'), open('다음 주', '2026-10-15'), open('진행', null)],
    } as unknown as Partial<LogsMockContext>)
    // 주간 10/5: 계획 기간은 10/12~18, 오늘은 10/8
    const week = await call('GET', '/api/worklog/logs/weekly/2026-10-05', ctx)
    expect(week.body.planCandidates.map((c: { taskId: string; reason: string }) => [c.taskId, c.reason])).toEqual([
      ['지난', 'OVERDUE'],
      ['다음 주', 'DUE'],
      ['진행', 'IN_PROGRESS'],
    ])
  })

  it('하루 마감: 계획 50줄을 넘거나 이슈가 2000자를 넘으면 400이고 일지는 그대로', async () => {
    const plans = Array.from({ length: 50 }, (_, i) => ({
      id: `p-${i}`,
      taskId: null,
      text: `${i}`,
      dueDate: null,
      scheduledAt: null,
    }))
    const stored = {
      id: 'log-1',
      type: 'DAILY',
      periodStart: '2026-10-08',
      status: 'DRAFT',
      version: 1,
      achievementsAuto: true,
      achievements: [],
      plans,
      issues: 'ㄱ'.repeat(1990),
      confirmedAt: null,
      snapshot: null,
      revisions: [],
    } as unknown as StoredLog
    const ctx = context({ logs: [stored] })
    const url = '/api/worklog/logs/daily/2026-10-08/close'

    const many = await call('POST', url, ctx, { carryOverTaskIds: ['t-rec'], issue: null, version: 1 })
    expect(many.status).toBe(400)
    expect(many.body.errors).toEqual([{ field: 'carryOverTaskIds', code: 'TOO_MANY' }])

    stored.plans = plans.slice(0, 49)
    const long = await call('POST', url, ctx, { carryOverTaskIds: ['t-rec'], issue: 'ㄴ'.repeat(10), version: 1 })
    expect(long.body.errors).toEqual([{ field: 'issue', code: 'TOO_LONG' }])
    expect(stored.plans).toHaveLength(49)
    expect(stored.status).toBe('DRAFT')

    const ok = await call('POST', url, ctx, { carryOverTaskIds: ['t-rec'], issue: 'ㄴ'.repeat(9), version: 1 })
    expect(ok.status).toBe(200)
    expect(stored.plans).toHaveLength(50)
  })
})

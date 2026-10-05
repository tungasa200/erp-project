import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../projects/api'
import { json, problem, stubFetch } from '../test/renderApp'
import { taskApi } from './api'
import { NeedsProjectError, saveQuickDraft, undoQuickSave } from './quickSave'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sales: Project = {
  id: 'p-sales',
  name: '영업',
  color: 'P2',
  archived: false,
  taskCount: 0,
  createdAt: '2026-10-01T00:00:00Z',
  version: 0,
}
const context = { projects: [sales], timeZone: 'Asia/Seoul' }
const task = (body: Record<string, unknown>) => ({ id: 't-1', status: 'TODO', progress: 0, version: 0, ...body })

function server(options: { scheduleFails?: boolean } = {}) {
  const calls: { key: string; body?: unknown }[] = []
  const handle = (key: string, respond: (body: Record<string, unknown>) => Response) => (init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ key, body })
    return respond(body ?? {})
  }
  const fetchMock = stubFetch({
    'POST /api/worklog/tags': handle('tag', (b) => json(201, { id: `tag-${String(b.name)}`, name: b.name })),
    'POST /api/worklog/tasks': handle('task', (b) => json(201, task(b))),
    'POST /api/worklog/schedules': handle('schedule', (b) =>
      options.scheduleFails ? problem(500, 'INTERNAL_ERROR') : json(201, { id: 's-1', ...b }),
    ),
    'DELETE /api/worklog/tasks/t-1': handle('delete-task', () => new Response(null, { status: 204 })),
    'DELETE /api/worklog/schedules/s-1': handle('delete-schedule', () => new Response(null, { status: 204 })),
  })
  return { calls, fetchMock }
}

describe('saveQuickDraft', () => {
  it('시간이 없으면 업무만 만든다 (태그는 get-or-create, 프로젝트는 이름으로 찾음)', async () => {
    const { calls } = server()
    const result = await saveQuickDraft(
      { title: '견적서 회신', project: '영업', tags: ['결제', '견적'], priority: 'LOW', due: '2026-10-09' },
      context,
    )
    expect(calls.map((c) => c.key)).toEqual(['tag', 'tag', 'task'])
    expect(calls[2].body).toEqual({
      title: '견적서 회신',
      priority: 'LOW',
      dueDate: '2026-10-09',
      projectId: 'p-sales',
      tagIds: ['tag-결제', 'tag-견적'],
    })
    expect(result.schedule).toBeUndefined()
  })

  it('시간이 있으면 사용자 시간대로 계산한 일정을 업무에 연결해 만든다', async () => {
    const { calls } = server()
    const result = await saveQuickDraft(
      { title: '견적서 작성', schedule: { date: '2026-10-07', start: '14:00', end: '16:00' } },
      context,
    )
    expect(calls.map((c) => c.key)).toEqual(['task', 'schedule'])
    expect(calls[1].body).toEqual({
      title: '견적서 작성',
      allDay: false,
      startAt: '2026-10-07T05:00:00.000Z',
      endAt: '2026-10-07T07:00:00.000Z',
      taskId: 't-1',
    })
    expect(result.schedule?.id).toBe('s-1')
  })

  it('아직 없는 프로젝트면 아무것도 만들지 않고 NeedsProjectError', async () => {
    const { calls } = server()
    await expect(saveQuickDraft({ title: '보도자료', project: '마케팅' }, context)).rejects.toBeInstanceOf(
      NeedsProjectError,
    )
    expect(calls).toEqual([])
  })

  it('일정을 못 만들면 만든 업무를 되돌리고 실패를 알린다', async () => {
    const { calls } = server({ scheduleFails: true })
    await expect(
      saveQuickDraft({ title: '회의', schedule: { date: '2026-10-07', start: '9:00', end: '10:00' } }, context),
    ).rejects.toThrow()
    expect(calls.map((c) => c.key)).toEqual(['task', 'schedule', 'delete-task'])
  })
})

describe('undoQuickSave', () => {
  it('일정을 먼저 지우고 업무를 보관한다', async () => {
    const { calls } = server()
    const result = await saveQuickDraft(
      { title: '회의', schedule: { date: '2026-10-07', start: '09:00', end: '10:00' } },
      context,
    )
    await undoQuickSave(result)
    expect(calls.map((c) => c.key).slice(-2)).toEqual(['delete-schedule', 'delete-task'])
  })
})

describe('taskApi.list', () => {
  it('배열 조건은 같은 이름을 반복하고 빈 값은 빼고 보낸다', async () => {
    const fetchMock = stubFetch({ 'GET /api/worklog/tasks': () => json(200, { items: [], nextCursor: null }) })
    await taskApi.list({ status: ['TODO', 'IN_PROGRESS'], scheduled: false, sort: 'due', limit: 30, q: '' }, 'c-2')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/worklog/tasks?status=TODO&status=IN_PROGRESS&scheduled=false&sort=due&limit=30&cursor=c-2',
    )
  })
})

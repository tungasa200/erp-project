import { beforeEach, describe, expect, it } from 'vitest'
import { handleScheduleMock } from '../calendar/mockSchedules'
import type { Task } from '../tasks/api'
import { handleWorklog } from './mockWorklog'

const r = {
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
  problem: (status: number, code: string) => new Response(JSON.stringify({ code }), { status }),
}

async function tasks(query = ''): Promise<Task[]> {
  const res = handleWorklog('GET', `/api/worklog/tasks${query}`, {}, r)!
  return ((await res.json()) as { items: Task[] }).items
}

beforeEach(() => {
  localStorage.removeItem('worklog.mock.worklog')
  localStorage.setItem('worklog.mock.schedules', '[]')
})

describe('가짜 업무 서버의 일정 배치 여부', () => {
  it('일정에 연결된 업무만 hasSchedule이고 scheduled 필터도 그 값으로 거른다', async () => {
    const [first, second] = await tasks()
    handleScheduleMock(
      'POST',
      '/api/worklog/schedules',
      {
        title: first.title,
        allDay: false,
        startAt: '2026-10-07T01:00:00Z',
        endAt: '2026-10-07T02:00:00Z',
        taskId: first.id,
      },
      r,
    )

    const all = await tasks()
    expect(all.find((t) => t.id === first.id)?.hasSchedule).toBe(true)
    expect(all.find((t) => t.id === second.id)?.hasSchedule).toBe(false)
    expect((await tasks('?scheduled=true')).map((t) => t.id)).toEqual([first.id])
    expect((await tasks('?scheduled=false')).map((t) => t.id)).not.toContain(first.id)
  })
})

describe('가짜 프로젝트의 남은 업무 수', () => {
  it('openTaskCount는 보관·완료를 뺀 업무 수이고 완료하면 줄어든다', async () => {
    const projects = async () =>
      (
        (await handleWorklog('GET', '/api/worklog/projects', {}, r)!.json()) as {
          items: { id: string; openTaskCount: number }[]
        }
      ).items
    const open = (await tasks()).filter((t) => t.status !== 'DONE' && t.projectId)
    const target = open[0]
    const before = (await projects()).find((p) => p.id === target.projectId)!.openTaskCount
    expect(before).toBe(open.filter((t) => t.projectId === target.projectId).length)

    handleWorklog('PATCH', `/api/worklog/tasks/${target.id}`, { version: target.version, status: 'DONE' }, r)
    expect((await projects()).find((p) => p.id === target.projectId)!.openTaskCount).toBe(before - 1)
  })
})

describe('가짜 업무 기록 수정(SCR-REC-01)', () => {
  const call = async (method: string, url: string, body: Record<string, unknown> = {}) => {
    const res = handleWorklog(method, url, body, r)!
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
  }

  it('시간 칸 규칙(D-101)을 검사하고 startAt으로 workDate를 서울 날짜로 계산한다', async () => {
    const base = { content: '회의', workDate: '2026-10-07' }
    expect((await call('POST', '/api/worklog/records', { ...base, startAt: '2026-10-07T01:00:00Z' })).body).toEqual({
      code: 'VALIDATION_FAILED',
    })
    const ok = await call('POST', '/api/worklog/records', {
      ...base,
      startAt: '2026-10-06T16:00:00Z',
      endAt: '2026-10-06T17:00:00Z',
    })
    expect(ok.status).toBe(201)
    expect(ok.body.workDate).toBe('2026-10-07')
    const order = await call('POST', '/api/worklog/records', {
      ...base,
      startAt: '2026-10-07T02:00:00Z',
      endAt: '2026-10-07T02:00:00Z',
    })
    expect(order.status).toBe(400)
    const both = await call('POST', '/api/worklog/records', {
      ...base,
      startAt: '2026-10-07T01:00:00Z',
      endAt: '2026-10-07T02:00:00Z',
      durationMin: 30,
    })
    expect(both.status).toBe(400)
  })

  it('내용을 PATCH하고, 보관한 기록은 GET으로 읽히고 복원하면 다시 고칠 수 있다', async () => {
    const created = (await call('POST', '/api/worklog/records', { content: '정리', workDate: '2026-10-07' })).body
    const url = `/api/worklog/records/${String(created.id)}`
    const edited = await call('PATCH', url, { version: 0, result: ' 끝 ', durationMin: 30 })
    expect(edited.body).toMatchObject({ result: '끝', durationMin: 30, version: 1, content: '정리' })

    await call('DELETE', url)
    expect((await call('GET', url)).body.deletedAt).not.toBeNull()
    expect((await call('PATCH', url, { version: 2, content: 'x' })).status).toBe(409)
    expect((await call('POST', `${url}/restore`)).body).toMatchObject({ deletedAt: null, version: 3 })
    expect((await call('PATCH', url, { version: 3, content: '정리 2' })).status).toBe(200)
  })
})

describe('가짜 타이머(P2-06)', () => {
  const on = { timeTrackingEnabled: true }
  const call = async (method: string, url: string, body = {}, settings = on) => {
    const res = handleWorklog(method, url, body, r, settings)!
    return { status: res.status, body: (await res.json()) as Record<string, never> }
  }

  it('옵션이 꺼져 있으면 시작은 409, 시작하면 실행 중, 다시 시작하면 앞 타이머를 멈추고(1분 미만은 버림) 정지는 멱등', async () => {
    expect(
      (await call('POST', '/api/worklog/timer/start', { content: '정리' }, { timeTrackingEnabled: false })).body,
    ).toEqual({ code: 'TIME_TRACKING_DISABLED' })
    const [task] = await tasks()
    const first = await call('POST', '/api/worklog/timer/start', { taskId: task.id })
    expect(first.body.running).toMatchObject({ content: task.title, taskId: task.id, endAt: null, status: 'CONFIRMED' })
    expect((await call('GET', '/api/worklog/timer')).body.running).toMatchObject({ taskId: task.id })

    const second = await call('POST', '/api/worklog/timer/start', { content: '메일' })
    expect(second.body.stopped).toMatchObject({ discarded: true, capped: false })
    expect(second.body.running).toMatchObject({ content: '메일', taskId: null })

    expect((await call('POST', '/api/worklog/timer/stop')).body.stopped).toMatchObject({ discarded: true })
    expect((await call('POST', '/api/worklog/timer/stop')).body).toEqual({ stopped: null, next: null })
    expect((await call('GET', '/api/worklog/timer')).body.running).toBeNull()
  })
})

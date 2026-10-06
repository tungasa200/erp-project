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

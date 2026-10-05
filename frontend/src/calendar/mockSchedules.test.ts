import { beforeEach, describe, expect, it } from 'vitest'
import type { Occurrence } from './api'
import { handleScheduleMock } from './mockSchedules'

const r = {
  json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status }),
  problem: (status: number, code: string) => new Response(JSON.stringify({ code }), { status }),
}

async function call(method: string, url: string, body: Record<string, unknown> = {}) {
  const res = handleScheduleMock(method, url, body, r)!
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}

async function list(from: string, to: string): Promise<Occurrence[]> {
  return (await call('GET', `/api/worklog/schedules?from=${from}&to=${to}`)).body.items
}

const daily = {
  title: '운동',
  allDay: false,
  startAt: '2026-10-05T00:00:00Z', // 서울 09:00 (브라우저 시간대가 무엇이든 시각은 그대로)
  endAt: '2026-10-05T01:00:00Z',
  recurrence: { frequency: 'DAILY', count: 3 },
}

beforeEach(() => {
  localStorage.setItem('worklog.mock.schedules', '[]')
})

describe('가짜 일정 서버', () => {
  it('반복 일정을 기간 안 회차로 전개하고 count에서 멈춘다', async () => {
    await call('POST', '/api/worklog/schedules', daily)
    const items = await list('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')
    expect(items).toHaveLength(3)
    expect(items.every((o) => o.recurring)).toBe(true)
  })

  it('"이 일정만" 옮겨도 회차 키는 그대로이고, 삭제한 회차는 빠진다', async () => {
    const created = (await call('POST', '/api/worklog/schedules', daily)).body
    const [first, second] = await list('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')
    const moved = await call('PATCH', `/api/worklog/schedules/${created.id}/occurrences/${first.occurrenceStart}`, {
      version: first.version,
      startAt: '2026-10-05T02:00:00Z',
      endAt: '2026-10-05T03:00:00Z',
    })
    expect(moved.status).toBe(200)
    expect(moved.body.occurrenceStart).toBe(first.occurrenceStart)
    expect(moved.body.modified).toBe(true)

    const del = await call('DELETE', `/api/worklog/schedules/${created.id}/occurrences/${second.occurrenceStart}`)
    expect(del.status).toBe(204)
    const items = await list('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')
    expect(items.map((o) => o.occurrenceStart)).not.toContain(second.occurrenceStart)
    expect(items).toHaveLength(2)
  })

  it('시각을 바꾸는 전체 수정은 회차별 변경을 지운다', async () => {
    const created = (await call('POST', '/api/worklog/schedules', daily)).body
    const [first] = await list('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')
    await call('DELETE', `/api/worklog/schedules/${created.id}/occurrences/${first.occurrenceStart}`)
    const current = (await call('GET', `/api/worklog/schedules/${created.id}`)).body
    await call('PATCH', `/api/worklog/schedules/${created.id}`, {
      version: current.version,
      startAt: '2026-10-05T01:00:00Z',
      endAt: '2026-10-05T02:00:00Z',
    })
    expect(await list('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')).toHaveLength(3)
  })

  it('오래된 version은 409', async () => {
    const created = (await call('POST', '/api/worklog/schedules', daily)).body
    const res = await call('PATCH', `/api/worklog/schedules/${created.id}`, {
      version: created.version + 1,
      title: 'x',
    })
    expect(res.status).toBe(409)
  })

  it('종일 일정은 마지막 날을 포함해 겹침을 판단한다', async () => {
    await call('POST', '/api/worklog/schedules', {
      title: '출장',
      allDay: true,
      startDate: '2026-10-08',
      endDate: '2026-10-09',
    })
    expect(await list('2026-10-09T12:00:00Z', '2026-10-09T13:00:00Z')).toHaveLength(1)
    expect(await list('2026-10-11T00:00:00Z', '2026-10-12T00:00:00Z')).toHaveLength(0)
  })
})

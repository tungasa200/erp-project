import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleScheduleMock } from '../calendar/mockSchedules'
import type { Task } from '../tasks/api'
import { handleWorklog, setMockHistorySeed } from './mockWorklog'

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

  it('정지는 소요시간을 분 버림으로 채우고, 그 기록은 durationMin:null을 함께 보내도 내용만 고쳐진다(TC-REC-01, 서버와 같게)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-07T01:00:00Z'), toFake: ['Date'] })
    try {
      await call('POST', '/api/worklog/timer/start', { content: '정리' })
      vi.setSystemTime(new Date('2026-10-07T01:30:50Z'))
      const stopped = (await call('POST', '/api/worklog/timer/stop')).body.stopped as { record: Record<string, never> }
      expect(stopped.record).toMatchObject({ endAt: '2026-10-07T01:30:50.000Z', durationMin: 30 })
      const { id, version, startAt, endAt } = stopped.record
      const url = `/api/worklog/records/${String(id)}`
      // 기록 수정 창은 시간 칸이 있으면 startAt·endAt과 durationMin:null을 함께 보낸다
      const edited = await call('PATCH', url, { version, content: '정리 끝', startAt, endAt, durationMin: null })
      expect(edited.status).toBe(200)
      expect(edited.body).toMatchObject({ content: '정리 끝', durationMin: 30 })
      expect((await call('PATCH', url, { version: version + 1, content: '정리 2' })).status).toBe(200)
      expect((await call('PATCH', url, { version: version + 2, durationMin: 10 })).status).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('가짜 빈 시간·시간 집계(P2-07)', () => {
  const call = async (method: string, url: string, body = {}) => {
    const res = handleWorklog(method, url, body, r, { timeTrackingEnabled: true })!
    return (await res.json()) as Record<string, never>
  }

  it('업무 시간대 중 확정 기록이 덮지 않은 15분 이상 구간, 직전 업무 후보, 지난 날짜 합계', async () => {
    // 서울 10/6 10:00–11:00, 11:10–12:00 기록 → 09:00–10:00, 12:00–18:00 (11:00–11:10은 15분 미만)
    await call('POST', '/api/worklog/records', {
      content: '설계',
      startAt: '2026-10-06T01:00:00Z',
      endAt: '2026-10-06T02:00:00Z',
    })
    await call('POST', '/api/worklog/records', {
      content: '리뷰',
      startAt: '2026-10-06T02:10:00Z',
      endAt: '2026-10-06T03:00:00Z',
    })
    await call('POST', '/api/worklog/records', { content: '메일', workDate: '2026-10-06', durationMin: 20 })

    const { items } = await call('GET', '/api/worklog/records/gaps?date=2026-10-06')
    expect(items).toEqual([
      expect.objectContaining({
        startAt: '2026-10-06T00:00:00.000Z',
        endAt: '2026-10-06T01:00:00.000Z',
        minutes: 60,
        previous: null,
      }),
      expect.objectContaining({
        startAt: '2026-10-06T03:00:00.000Z',
        endAt: '2026-10-06T09:00:00.000Z',
        minutes: 360,
        previous: { content: '리뷰', taskId: null },
      }),
    ])
    expect((await call('GET', '/api/worklog/records/gaps?date=2999-01-01')).items).toEqual([])
    expect(await call('GET', '/api/worklog/records/time-summary?from=2026-10-06&to=2026-10-06')).toMatchObject({
      totalMin: 130,
      recordCount: 3,
    })
  })
})

describe('가짜 통계(P4-02, GET /stats·/stats/plan-vs-actual)', () => {
  const get = async (url: string) => {
    const res = handleWorklog('GET', url, {}, r)!
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('daily는 기간의 모든 날을 0 포함으로 주고, 기간이 거꾸로면 400', async () => {
    const { status, body } = await get('/api/worklog/stats?from=2026-10-01&to=2026-10-07')
    expect(status).toBe(200)
    expect((body.daily as { date: string }[]).map((d) => d.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ])
    expect((await get('/api/worklog/stats?from=2026-10-07&to=2026-10-01')).status).toBe(400)
  })

  it('예상은 업무에 연결된 시간 일정 길이, 실제는 그 업무의 확정 기록, 예상 없는 업무는 계획 밖', async () => {
    const [first] = await tasks()
    handleScheduleMock(
      'POST',
      '/api/worklog/schedules',
      // 서울 10:00~12:00(월요일 2026-10-05)
      {
        title: first.title,
        allDay: false,
        startAt: '2026-10-05T01:00:00Z',
        endAt: '2026-10-05T03:00:00Z',
        taskId: first.id,
      },
      r,
    )
    handleWorklog(
      'POST',
      '/api/worklog/records',
      { content: '작업', taskId: first.id, workDate: '2026-10-05', durationMin: 90 },
      r,
    )
    handleWorklog('POST', '/api/worklog/records', { content: '잡무', workDate: '2026-10-06', durationMin: 30 }, r)

    const { body } = await get('/api/worklog/stats/plan-vs-actual?from=2026-10-05&to=2026-10-11')
    expect(body.weeks).toEqual([{ weekStart: '2026-10-05', plannedMin: 120, actualMin: 90, unplannedMin: 30 }])
    expect(body.topDiffs).toEqual([
      { taskId: first.id, title: first.title, projectId: first.projectId, plannedMin: 120, actualMin: 90 },
    ])
  })
})

describe('데모 시드: 지난 2주 확정 기록·완료 업무·확정 일지', () => {
  const get = async (url: string) => (await handleWorklog('GET', url, {}, r)!.json()) as Record<string, unknown>
  const seoul = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + offset * 86_400_000))

  it('처음 불러오면 지난 근무일마다 확정 기록 3건, 가장 최근 근무일만 빼고 일지 확정, 통계에 숫자가 찬다', async () => {
    setMockHistorySeed(true)
    try {
      const from = seoul(-14)
      const to = seoul(-1)
      const stats = await get(`/api/worklog/stats?from=${from}&to=${to}`)
      const daily = stats.daily as { date: string; completedTaskCount: number; recordedMin?: number }[]
      expect(daily.reduce((n, d) => n + d.completedTaskCount, 0)).toBeGreaterThanOrEqual(5)

      const logs = (await get(`/api/worklog/logs?type=DAILY&from=${from}&to=${to}`)) as {
        items: { periodStart: string; status: string; workday: boolean }[]
        unconfirmedDays: number
      }
      // 목록은 최근 날짜가 먼저일 수 있어 날짜 순으로 본다
      const workdays = logs.items.filter((i) => i.workday).sort((a, b) => a.periodStart.localeCompare(b.periodStart))
      expect(workdays.length).toBeGreaterThanOrEqual(8)
      expect(workdays.slice(0, -1).every((i) => i.status === 'CONFIRMED')).toBe(true)
      expect(workdays.at(-1)!.status).not.toBe('CONFIRMED')

      // 다시 불러와도 두 번 채우지 않는다
      const again = (await get(`/api/worklog/logs?type=DAILY&from=${from}&to=${to}`)) as typeof logs
      expect(again.items.filter((i) => i.status === 'CONFIRMED')).toHaveLength(workdays.length - 1)
    } finally {
      setMockHistorySeed(false)
    }
  })
})

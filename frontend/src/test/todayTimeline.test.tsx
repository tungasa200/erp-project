import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Occurrence } from '../calendar/api'
import type { WorkRecord } from '../records/api'
import { json, ME, renderApp, stubFetch } from './renderApp'

// 서울 2026-10-07(수) 12:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const occurrence = (id: string, title: string, startAt: string, endAt: string): Occurrence => ({
  scheduleId: id,
  occurrenceStart: startAt,
  title,
  allDay: false,
  startAt,
  endAt,
  startDate: null,
  endDate: null,
  memo: null,
  projectId: null,
  taskId: null,
  recurring: false,
  modified: false,
  version: 0,
})

const rec = (id: string, fields: Partial<WorkRecord>): WorkRecord => ({
  id,
  status: 'CONFIRMED',
  workDate: '2026-10-07',
  content: id,
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: null,
  occurrenceStart: null,
  result: null,
  outcome: null,
  progress: null,
  startAt: null,
  endAt: null,
  durationMin: null,
  deletedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  version: 0,
  ...fields,
})

// 서울 시각: 09:00–09:30 스탠드업(끝남, 했어요), 10:00–11:00 리뷰(끝남, 확인 대기), 11:00–11:30 회고(끝남, 확인 대기),
// 11:30–13:00 워크숍(진행 중), 15:00–16:00 미팅(예정)
const OCCURRENCES = [
  occurrence('s1', '데일리 스탠드업', '2026-10-07T00:00:00Z', '2026-10-07T00:30:00Z'),
  occurrence('s2', '코드 리뷰', '2026-10-07T01:00:00Z', '2026-10-07T02:00:00Z'),
  occurrence('s3', '짧은 회고', '2026-10-07T02:00:00Z', '2026-10-07T02:30:00Z'),
  occurrence('s4', '워크숍', '2026-10-07T02:30:00Z', '2026-10-07T04:00:00Z'),
  occurrence('s5', '고객사 미팅', '2026-10-07T06:00:00Z', '2026-10-07T07:00:00Z'),
]
const link = (o: Occurrence) => ({ scheduleId: o.scheduleId, occurrenceStart: o.occurrenceStart })
const RECORDS = [
  rec('r1', { ...link(OCCURRENCES[0]), content: '데일리 스탠드업' }),
  rec('r2', { ...link(OCCURRENCES[1]), content: '코드 리뷰', status: 'PENDING' }),
  rec('r3', { ...link(OCCURRENCES[2]), content: '짧은 회고', status: 'PENDING' }),
  // 시간을 남긴 직접 기록(실제 열)과 시간 없는 기록
  rec('r4', { content: '버그 수정', startAt: '2026-10-07T00:30:00Z', endAt: '2026-10-07T01:30:00Z' }),
  rec('r5', { content: '메일 정리', durationMin: 20 }),
]

function server(options: { timeTracking?: boolean; occurrences?: Occurrence[]; holdSchedules?: boolean } = {}) {
  let records = RECORDS.map((r) => ({ ...r }))
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, { userId: 'u-1', settings: { timeTrackingEnabled: options.timeTracking ?? false } }),
    'GET /api/worklog/schedules': () =>
      options.holdSchedules
        ? new Promise<Response>(() => {})
        : json(200, { items: options.occurrences ?? OCCURRENCES }),
  })
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (!url.startsWith('/api/worklog/records')) return base(input, init)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (url === '/api/worklog/records/pending') {
      return json(200, {
        items: records
          .filter((r) => r.status === 'PENDING')
          .map((r) => ({ ...r, plan: { title: r.content, allDay: false } })),
      })
    }
    if (method === 'GET') return json(200, { items: records })
    if (method === 'PATCH') {
      const id = url.split('/').pop()!
      const { status } = body as { status: WorkRecord['status'] }
      records = records.map((r) => (r.id === id ? { ...r, status, version: r.version + 1 } : r))
      return json(
        200,
        records.find((r) => r.id === id),
      )
    }
    return base(input, init)
  })
  return { calls }
}

const section = () => screen.findByRole('region', { name: '오늘 일정' })

describe('SCR-HOME-01 ③ 오늘 일정 (P2-08)', () => {
  it('옵션 꺼짐: 계획을 시간순으로, 끝난 것은 기록 상태, 진행 중·지금 줄, 확인 대기는 그 자리에서 처리 버튼', async () => {
    server()
    renderApp('/')
    const today = await section()
    await waitFor(() => expect(within(today).getByRole('button', { name: '코드 리뷰 했어요' })).toBeInTheDocument())
    const rows = within(today)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(rows).toEqual([
      expect.stringMatching(/^09:00 – 09:30데일리 스탠드업.*했어요$/),
      expect.stringMatching(/^10:00 – 11:00코드 리뷰확인 대기했어요수정안 했어요$/),
      expect.stringMatching(/^11:00 – 11:30짧은 회고확인 대기/),
      expect.stringMatching(/^11:30 – 13:00워크숍진행 중$/),
      '지금 12:00',
      '15:00 – 16:00고객사 미팅',
    ])
    // 실제(시간 기록) 열은 옵션이 꺼져 있으면 없다
    expect(within(today).queryByRole('list', { name: '실제' })).not.toBeInTheDocument()
  })

  it('했어요는 PATCH CONFIRMED, 버튼이 사라지면 다음 확인 대기의 했어요로 포커스, 마지막이면 제목으로', async () => {
    const { calls } = server()
    renderApp('/')
    const today = await section()
    const yes = await within(today).findByRole('button', { name: '코드 리뷰 했어요' })
    yes.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(within(today).getByRole('button', { name: '짧은 회고 했어요' })).toHaveFocus())
    expect(calls).toContainEqual({
      method: 'PATCH',
      url: '/api/worklog/records/r2',
      body: { status: 'CONFIRMED', version: 0 },
    })
    expect(await screen.findByText('1건을 했어요로 기록했어요')).toBeInTheDocument()

    await userEvent.click(within(today).getByRole('button', { name: '짧은 회고 안 했어요' }))
    await waitFor(() => expect(within(today).getByRole('heading', { name: '오늘 일정' })).toHaveFocus())
    expect(within(today).getByText('안 했어요')).toBeInTheDocument()
  })

  it('옵션 켜짐: 계획/실제 두 열, 실제는 시간을 남긴 확정 기록, 확인 대기 블록을 누르면 확인 대기 패널', async () => {
    server({ timeTracking: true })
    renderApp('/')
    const today = await section()
    const actual = await within(today).findByRole('list', { name: '실제' })
    await waitFor(() => expect(within(actual).getByRole('img', { name: '09:30–10:30 버그 수정' })).toBeInTheDocument())
    const plan = within(today).getByRole('list', { name: '계획' })
    expect(within(plan).getByRole('img', { name: '09:00–09:30 데일리 스탠드업, 했어요' })).toBeInTheDocument()
    expect(within(today).getByText('시간 없이 남긴 기록 1건 · 20분')).toBeInTheDocument()
    expect(within(today).getByText('지금 12:00')).toBeInTheDocument()

    await userEvent.click(within(plan).getByRole('button', { name: '10:00–11:00 코드 리뷰, 확인 대기, 눌러서 확인' }))
    expect(await screen.findByRole('dialog', { name: /확인 대기/ })).toBeInTheDocument()
  })

  it('불러오는 동안 "없어요"를 먼저 보이지 않는다', async () => {
    server({ holdSchedules: true })
    renderApp('/')
    const loading = await section()
    expect(within(loading).queryByText('오늘 잡힌 일정이 없어요')).not.toBeInTheDocument()
  })

  it('일정이 없으면 비었다고 알린다', async () => {
    server({ occurrences: [] })
    renderApp('/')
    expect(await within(await section()).findByText('오늘 잡힌 일정이 없어요')).toBeInTheDocument()
  })
})

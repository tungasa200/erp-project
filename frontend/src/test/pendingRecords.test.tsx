import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingRecord } from '../records/pending'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

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

const record = (id: string, title: string, workDate: string, plan: Partial<PendingRecord['plan']>): PendingRecord => ({
  id,
  status: 'PENDING',
  workDate,
  content: title,
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: `s-${id}`,
  occurrenceStart: plan.startAt ?? null,
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
  plan: { title, allDay: false, startAt: null, endAt: null, startDate: null, endDate: null, ...plan },
})

const PENDING = [
  // 어제 09:00–10:00, 어제 종일, 오늘 09:00–10:30
  record('a', '데일리 스탠드업', '2026-10-06', { startAt: '2026-10-06T00:00:00Z', endAt: '2026-10-06T01:00:00Z' }),
  record('b', '워크숍', '2026-10-06', { allDay: true, startDate: '2026-10-06', endDate: '2026-10-06' }),
  record('c', '코드 리뷰', '2026-10-07', { startAt: '2026-10-07T00:00:00Z', endAt: '2026-10-07T01:30:00Z' }),
]

function server(options: { pending?: PendingRecord[]; hold?: boolean; patchFails?: boolean } = {}) {
  let pending = (options.pending ?? PENDING).map((x) => ({ ...x }))
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetchMock = stubFetch({ 'GET /api/users/me': () => json(200, ME) })
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (!url.startsWith('/api/worklog/records')) return base(input, init)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET' && url === '/api/worklog/records/pending') {
      if (options.hold) return new Promise<Response>(() => {})
      return json(200, { items: pending })
    }
    const one = /^\/api\/worklog\/records\/([a-z])$/.exec(url)
    if (method === 'GET' && one)
      return json(
        200,
        PENDING.find((x) => x.id === one[1]),
      )
    if (method === 'POST' && url === '/api/worklog/records/pending/confirm') {
      const ids = (body as { ids: string[] }).ids
      const done = pending.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, status: 'CONFIRMED', version: 1 }))
      pending = pending.filter((x) => !ids.includes(x.id))
      return json(200, { items: done })
    }
    if (method === 'PATCH') {
      if (options.patchFails) return problem(500, 'INTERNAL')
      const id = url.split('/').pop()!
      const { status } = body as { status: PendingRecord['status'] }
      const found = PENDING.find((x) => x.id === id)!
      if (status === 'PENDING') pending = [...pending, { ...found, version: 2 }]
      else pending = pending.filter((x) => x.id !== id)
      return json(200, { ...found, status, version: status === 'PENDING' ? 2 : 1 })
    }
    return base(input, init)
  })
  return { calls }
}

async function openPanel() {
  await userEvent.click(await screen.findByRole('button', { name: /확인 대기 3건 한 번에 처리/ }))
  return screen.getByRole('dialog', { name: '확인 대기 3건' })
}

describe('SCR-HOME-02 확인 대기 목록', () => {
  it('요약 카드에 개수, 2건 이상이면 띠를 보이고, 띠를 누르면 패널이 열려 제목에 포커스가 간다', async () => {
    server()
    renderApp('/')
    const cards = await screen.findByRole('list', { name: '요약' })
    await waitFor(() =>
      expect(within(cards).getByRole('button', { name: /확인 대기/ })).toHaveTextContent('확인 대기3최근 7일'),
    )
    const panel = await openPanel()
    expect(within(panel).getByRole('heading', { name: '확인 대기 3건' })).toHaveFocus()
  })

  it('날짜별로 묶고 계획 시간을 보여 준다(기록의 시간 칸은 비어 있다)', async () => {
    server()
    renderApp('/')
    const panel = await openPanel()
    const yesterday = within(panel).getByRole('region', { name: '어제 · 10/6(화)' })
    expect(
      within(yesterday)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('데일리 스탠드업09:00 – 10:00'), expect.stringContaining('워크숍종일')])
    const today = within(panel).getByRole('region', { name: '오늘 · 10/7(수)' })
    expect(within(today).getByText('09:00 – 10:30')).toBeInTheDocument()
  })

  it('했어요는 PATCH CONFIRMED, 행이 빠지면 다음 행의 했어요로 포커스, 되돌리기는 PATCH PENDING', async () => {
    const { calls } = server()
    renderApp('/')
    const panel = await openPanel()
    within(panel).getByRole('button', { name: '데일리 스탠드업 했어요' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(within(panel).queryByText('데일리 스탠드업')).not.toBeInTheDocument())
    expect(calls).toContainEqual({
      method: 'PATCH',
      url: '/api/worklog/records/a',
      body: { status: 'CONFIRMED', version: 0 },
    })
    await waitFor(() => expect(within(panel).getByRole('button', { name: '워크숍 했어요' })).toHaveFocus())

    await userEvent.click(await screen.findByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        url: '/api/worklog/records/a',
        body: { status: 'PENDING', version: 1 },
      }),
    )
  })

  it('수정은 기록 모달을 열고, 저장하면 고친 칸과 했어요를 한 요청으로 보내 행이 빠지고 포커스는 다음 행으로 간다', async () => {
    const { calls } = server()
    renderApp('/')
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: '데일리 스탠드업 수정' }))
    const dialog = await screen.findByRole('dialog', { name: '확인 대기 수정' })
    const result = await within(dialog).findByLabelText('결과 한 줄')
    await userEvent.type(result, '공유 완료')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '확인 대기 수정' })).not.toBeInTheDocument())
    expect(calls).toContainEqual({
      method: 'PATCH',
      url: '/api/worklog/records/a',
      body: expect.objectContaining({ status: 'CONFIRMED', result: '공유 완료', version: 0 }),
    })
    await waitFor(() => expect(within(panel).queryByText('데일리 스탠드업')).not.toBeInTheDocument())
    await waitFor(() => expect(within(panel).getByRole('button', { name: '워크숍 했어요' })).toHaveFocus())
  })

  it('안 했어요는 PATCH DISMISSED', async () => {
    const { calls } = server()
    renderApp('/')
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: '워크숍 안 했어요' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        url: '/api/worklog/records/b',
        body: { status: 'DISMISSED', version: 0 },
      }),
    )
    expect(await screen.findByText('1건을 안 했어요로 표시했어요')).toBeInTheDocument()
  })

  it('모두 했어요는 화면에 보인 id만 보내고, 0건이 되면 패널을 닫고 포커스를 요약 카드로 돌려준다', async () => {
    const { calls } = server()
    renderApp('/')
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: '3건 모두 했어요' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/worklog/records/pending/confirm',
      body: { ids: ['a', 'b', 'c'] },
    })
    expect(await screen.findByText('3건을 모두 했어요로 기록했어요')).toBeInTheDocument()
    // 띠는 사라졌으므로 요약 카드로
    await waitFor(() => expect(screen.getByRole('button', { name: /확인 대기/ })).toHaveFocus())
    expect(screen.queryByRole('button', { name: /한 번에 처리/ })).not.toBeInTheDocument()
  })

  it('Esc로 닫으면 연 버튼으로 포커스가 돌아간다', async () => {
    server()
    renderApp('/')
    await openPanel()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /확인 대기 3건 한 번에 처리/ })).toHaveFocus()
  })

  it('처리에 실패하면 행을 그대로 두고 오류 토스트', async () => {
    server({ patchFails: true })
    renderApp('/')
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: '워크숍 했어요' }))
    expect(await screen.findByText('잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요')).toBeInTheDocument()
    expect(within(panel).getByText('워크숍')).toBeInTheDocument()
  })

  it('1건이면 띠 없이 카드로 열고, 0건이면 카드는 "처리할 것 없어요"이고 열리지 않는다', async () => {
    server({ pending: [PENDING[0]] })
    renderApp('/')
    const card = await screen.findByRole('button', { name: /확인 대기/ })
    await waitFor(() => expect(card).toHaveTextContent('확인 대기1'))
    expect(screen.queryByRole('button', { name: /한 번에 처리/ })).not.toBeInTheDocument()
    await userEvent.click(card)
    const panel = screen.getByRole('dialog', { name: '확인 대기 1건' })
    await userEvent.click(within(panel).getByRole('button', { name: '데일리 스탠드업 했어요' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(card).toHaveTextContent('처리할 것 없어요'))
    expect(card).toHaveAttribute('aria-disabled', 'true')
  })

  it('불러오는 동안 카드에 0을 먼저 보이지 않는다', async () => {
    server({ hold: true })
    renderApp('/')
    const card = await screen.findByRole('button', { name: /확인 대기/ })
    await waitFor(() => expect(within(card).getAllByRole('status')).toHaveLength(2))
    expect(card).not.toHaveTextContent(/\d/)
  })
})

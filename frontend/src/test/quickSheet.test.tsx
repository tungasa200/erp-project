import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingRecord } from '../records/pending'
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
  // offline 이벤트를 보낸 테스트 뒤에 React Query(onlineManager)가 끊김으로 남지 않게 되돌린다
  window.dispatchEvent(new Event('online'))
})

const pending = (id: string, title: string): PendingRecord => ({
  id,
  status: 'PENDING',
  workDate: '2026-10-07',
  content: title,
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: `s-${id}`,
  occurrenceStart: '2026-10-07T04:00:00Z',
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
  plan: {
    title,
    allDay: false,
    startAt: '2026-10-07T04:00:00Z',
    endAt: '2026-10-07T05:00:00Z',
    startDate: '2026-10-07',
    endDate: '2026-10-07',
  },
})

async function openSheet(path = '/tasks') {
  const result = renderApp(path)
  const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
  const plus = within(tabs).getByRole('button', { name: '빠른 기록' })
  await userEvent.click(plus)
  const sheet = await screen.findByRole('dialog', { name: '빠른 기록' })
  return { ...result, tabs, plus, sheet }
}

// 모바일 하단 탭·시트는 CSS로만 숨겨 jsdom에서는 늘 있다
describe('SCR-MOB-01 빠른 기록 바텀시트 (P4-03)', () => {
  it('가운데 +로 열면 입력칸에 포커스하고, Esc로 닫으면 +로 돌아오며 쓰던 글은 남는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { plus, sheet } = await openSheet()
    const input = within(sheet).getByRole('textbox', { name: '한 줄 입력' })
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.type(input, '견적서 작성')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '빠른 기록' })).not.toBeInTheDocument()
    expect(plus).toHaveFocus()

    await userEvent.click(plus)
    expect(await screen.findByRole('textbox', { name: '한 줄 입력' })).toHaveValue('견적서 작성')
  })

  it('손잡이(빠른 기록 닫기)를 눌러 닫는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { sheet, plus } = await openSheet()
    await userEvent.click(within(sheet).getByRole('button', { name: '빠른 기록 닫기' }))
    expect(screen.queryByRole('dialog', { name: '빠른 기록' })).not.toBeInTheDocument()
    expect(plus).toHaveFocus()
  })

  it('Tab은 시트 안을 돈다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { sheet } = await openSheet()
    const grip = within(sheet).getByRole('button', { name: '빠른 기록 닫기' })
    grip.focus()
    await userEvent.tab({ shift: true })
    expect(sheet).toContainElement(document.activeElement as HTMLElement)
    await userEvent.tab()
    expect(grip).toHaveFocus()
  })

  it('저장하면 시트를 닫고 되돌리기 토스트를 띄운다', async () => {
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'POST /api/worklog/tasks': () => json(201, { id: 't-new', title: '견적서 작성', version: 0 }),
    })
    const { sheet } = await openSheet()
    await userEvent.type(within(sheet).getByRole('textbox', { name: '한 줄 입력' }), '견적서 작성{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '빠른 기록' })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/worklog/tasks', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText(/업무 1개를 추가했어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument()
  })

  it('입력 중에는 확인 대기를 숨기고, 비우면 다시 보인다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/records/pending': () => json(200, { items: [pending('a', '고객사 미팅')] }),
    })
    const { sheet } = await openSheet()
    expect(await within(sheet).findByText('확인 대기 · 오늘 13:00 – 14:00')).toBeInTheDocument()
    const input = within(sheet).getByRole('textbox', { name: '한 줄 입력' })
    await userEvent.type(input, '보고')
    expect(within(sheet).queryByText('고객사 미팅')).not.toBeInTheDocument()
    await userEvent.clear(input)
    expect(within(sheet).getByText('고객사 미팅')).toBeInTheDocument()
  })

  it('확인 대기 1건을 했어요로 바꾸고, n건 더 보기는 확인 대기 패널을 연다', async () => {
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/records/pending': () =>
        json(200, { items: [pending('a', '고객사 미팅'), pending('b', '주간 회의'), pending('c', '코드 리뷰')] }),
      'PATCH /api/worklog/records/a': () =>
        json(200, { ...pending('a', '고객사 미팅'), status: 'CONFIRMED', version: 1 }),
    })
    const { sheet } = await openSheet()
    await userEvent.click(await within(sheet).findByRole('button', { name: '고객사 미팅 했어요' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/worklog/records/a', expect.objectContaining({ method: 'PATCH' })),
    )

    await userEvent.click(within(sheet).getByRole('button', { name: '2건 더 보기' }))
    expect(screen.queryByRole('dialog', { name: '빠른 기록' })).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: /확인 대기/ })).toBeInTheDocument()
  })

  it('확인 대기가 없으면 카드 자리를 두지 않는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { sheet } = await openSheet()
    expect(within(sheet).getByText('시간을 적으면 일정도 함께 만들어져요.')).toBeInTheDocument()
    expect(within(sheet).queryByText(/확인 대기/)).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /타이머/ })).not.toBeInTheDocument()
  })

  it('시간 기록 옵션이 켜져 있으면 타이머 시작 버튼이 보이고 누르면 타이머 창을 연다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () =>
        json(200, {
          userId: 'u-1',
          settings: {
            timeTrackingEnabled: true,
            dailyCloseNotifyEnabled: false,
            workHoursStart: '09:00',
            workHoursEnd: '18:00',
            dailyCloseTime: '18:00',
            version: 0,
          },
        }),
    })
    const { sheet } = await openSheet()
    await userEvent.click(await within(sheet).findByRole('button', { name: '지금 하는 일로 타이머 시작' }))
    expect(screen.queryByRole('dialog', { name: '빠른 기록' })).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: /타이머/ })).toBeInTheDocument()
  })

  it('끊긴 동안에도 시트는 열리지만 입력·했어요를 끈다 (SCR-SYS-02 ③)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/records/pending': () => json(200, { items: [pending('a', '고객사 미팅')] }),
    })
    const { sheet } = await openSheet()
    const input = within(sheet).getByRole('textbox', { name: '한 줄 입력' })
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', '연결되면 입력할 수 있어요')
    expect(await within(sheet).findByRole('button', { name: '고객사 미팅 했어요' })).toBeDisabled()
  })

  it('끊긴 동안 열면 막힌 입력칸 대신 손잡이(닫기)에 포커스한다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { sheet } = await openSheet()
    expect(within(sheet).getByRole('button', { name: '빠른 기록 닫기' })).toHaveFocus()
  })

  it('쓰는 중에 끊기면 포커스를 시트 안 손잡이로 옮긴다', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { sheet } = await openSheet()
    expect(within(sheet).getByRole('textbox', { name: '한 줄 입력' })).toHaveFocus()
    onLine.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '빠른 기록 닫기' })).toHaveFocus())
  })

  it('마지막 확인 대기를 했어요로 바꾸면 사라지는 카드 대신 입력칸으로 포커스를 옮긴다', async () => {
    let items = [pending('a', '고객사 미팅')]
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/records/pending': () => json(200, { items }),
      'PATCH /api/worklog/records/a': () => {
        items = []
        return json(200, { ...pending('a', '고객사 미팅'), status: 'CONFIRMED', version: 1 })
      },
    })
    const { sheet } = await openSheet()
    await userEvent.click(await within(sheet).findByRole('button', { name: '고객사 미팅 했어요' }))
    await waitFor(() =>
      expect(within(sheet).queryByRole('button', { name: '고객사 미팅 했어요' })).not.toBeInTheDocument(),
    )
    expect(within(sheet).getByRole('textbox', { name: '한 줄 입력' })).toHaveFocus()
  })

  it('PWA 바로가기(/?quick=1)로 열면 시트를 바로 띄우고 주소에서 뺀다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/?quick=1')
    expect(await screen.findByRole('dialog', { name: '빠른 기록' })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByRole('dialog', { name: '빠른 기록' })).toBeInTheDocument()
  })
})

describe('SCR-COM-01 ⑤ 하단 탭 아이콘·더보기 (P4-03)', () => {
  it('더보기는 업무·통계·보관함·설정을 담는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '더보기' }))
    const menu = within(tabs).getByRole('list', { name: '더보기 메뉴' })
    expect(
      within(menu)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['업무', '/tasks'],
      ['통계', '/stats'],
      ['보관함', '/tasks/archive'],
      ['설정', '/settings'],
    ])
  })
})

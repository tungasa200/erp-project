// 홈 ⑤ 오늘 마감·⑦ 이번 주 마감 자리(업무일지 숨김 2026-10-12로 이름만 바뀜)(SCR-HOME-01, P3-04)와 명령 팔레트 '하루 마감'(SCR-COM-03 → SCR-LOG-03)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const confirmedLog = () => ({
  id: 'log-1',
  type: 'DAILY',
  periodStart: '2026-10-07',
  periodEnd: '2026-10-07',
  status: 'CONFIRMED',
  version: 1,
  confirmedAt: '2026-10-07T03:00:00Z',
  sourceChangedAfterConfirm: false,
  planCandidates: [],
  content: {
    title: '업무일지',
    planTitle: '다음 근무일 계획',
    planPeriod: { start: '2026-10-08', end: '2026-10-08' },
    author: { name: null, organization: null, position: null },
    achievementsAuto: true,
    achievements: [],
    plans: [],
    issues: null,
    metrics: {
      recordCount: 0,
      done: 0,
      reviewRequested: 0,
      inProgress: 0,
      completedTaskCount: 0,
      pendingCount: 0,
      totalMin: null,
    },
    days: [],
    projects: [],
    time: null,
  },
})

const closePlan = {
  date: '2026-10-07',
  log: {
    type: 'DAILY',
    periodStart: '2026-10-07',
    periodEnd: '2026-10-07',
    status: 'NOT_WRITTEN',
    logId: null,
    workday: true,
    holiday: null,
  },
  nextWorkday: '2026-10-08',
  pendingCount: 0,
  planScope: 'NEXT_WORKDAY',
  carryOverCandidates: [],
  suggestions: [],
}

describe('홈 마감 카드 (SCR-HOME-01 ⑤⑦)', () => {
  it('오른쪽 열에 오늘 마감 → 다가오는 일정 → 이번 주 마감 순으로 놓고, 일지로 가는 링크는 없다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')

    const today = await screen.findByRole('region', { name: '오늘 마감' })
    expect(await within(today).findByText('확정 기록 0건 · 다음 근무일 계획 0건 · 이슈 없음')).toBeInTheDocument()
    expect(within(today).queryByRole('link')).not.toBeInTheDocument()
    const week = screen.getByRole('region', { name: '이번 주 마감' })
    expect(within(week).queryByRole('link')).not.toBeInTheDocument()

    const order = screen
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-labelledby'))
      .filter((id) => id === 'home-log-today' || id === 'home-log-week' || id === 'home-upcoming')
    expect(order[0]).toBe('home-log-today')
    expect(order.at(-1)).toBe('home-log-week')
  })
})

describe('명령 팔레트 하루 마감 (SCR-COM-03, SCR-LOG-03)', () => {
  it('어느 화면에서든 오늘 마감을 열고, Esc로 닫으면 팔레트를 열기 전 자리로 포커스가 돌아온다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, closePlan),
    })
    renderApp('/')

    const nav = await screen.findByRole('navigation', { name: '주 메뉴' })
    const before = within(nav).getByRole('link', { name: '통계' })
    before.focus()
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: '명령 팔레트' })
    await user.type(within(palette).getByRole('combobox'), '하루')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: '하루 마감 1/2' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('heading', { name: /하루 마감/ })).not.toBeInTheDocument())
    expect(before).toHaveFocus()
  })

  it('빠른 마감: 단계 없이 바로 확정하고 완료 창을 보인다', async () => {
    const user = userEvent.setup()
    const close = vi.fn(() =>
      json(200, {
        log: confirmedLog(),
        suggestions: [],
      }),
    )
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, closePlan),
      'POST /api/worklog/logs/daily/2026-10-07/close': close,
    })
    renderApp('/')
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: '명령 팔레트' })
    await user.type(within(palette).getByRole('combobox'), '빠른 마감')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('명령 팔레트 업무 찾기 (UX-COM-03, D-212 Q6)', () => {
  const found = (id: string, title: string) => ({
    id,
    title,
    status: 'TODO',
    priority: 'NORMAL',
    dueDate: null,
    progress: 0,
    completedAt: null,
    projectId: null,
    tagIds: [],
    hasSchedule: false,
    memo: null,
    carriedOverFromId: null,
    deletedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 0,
  })

  it('제목이 정확히 같은 업무가 있으면 그 업무가 첫 항목이라 Enter로 연다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/tasks': () =>
        json(200, { items: [found('t-2', '견적서 회신 준비'), found('t-1', '견적서 회신')], nextCursor: null }),
    })
    const { router } = renderApp('/')
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: '명령 팔레트' })
    await user.type(within(palette).getByRole('combobox'), '견적서 회신')
    const exact = await within(palette).findByRole('option', { name: /^견적서 회신$/ })
    await waitFor(() => expect(exact).toHaveAttribute('aria-selected', 'true'))
    expect(within(palette).getByRole('option', { name: /업무로 추가/ })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/t-1'))
  })
})

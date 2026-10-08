// 홈 ⑤ 오늘 일지·⑦ 이번 주 일지 자리(SCR-HOME-01, P3-04)와 명령 팔레트 '하루 마감'(SCR-COM-03 → SCR-LOG-03)
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

describe('홈 일지 카드 (SCR-HOME-01 ⑤⑦)', () => {
  it('오른쪽 열에 오늘 일지 → 다가오는 일정 → 이번 주 일지 순으로 놓는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')

    const today = await screen.findByRole('region', { name: '오늘 일지' })
    expect(await within(today).findByText('실적 0건 · 계획 0건 · 이슈 없음')).toBeInTheDocument()
    expect(within(today).getByRole('link', { name: '일지 보기' })).toHaveAttribute('href', '/logs/daily/2026-10-07')
    const week = screen.getByRole('region', { name: '이번 주 일지' })
    expect(within(week).getByRole('link', { name: '주간 일지' })).toHaveAttribute('href', '/logs/weekly/2026-10-05')

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
    renderApp('/logs')

    const nav = await screen.findByRole('navigation', { name: '주 메뉴' })
    const before = within(nav).getByRole('link', { name: '업무일지' })
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
})

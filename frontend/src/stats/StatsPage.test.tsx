import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from '../test/renderApp'
import type { PlanVsActual, Stats } from './api'
import { StatsPage } from './StatsPage'

const PROJECTS = [
  {
    id: 'p-dev',
    name: '개발',
    color: 'P1',
    archived: false,
    taskCount: 3,
    openTaskCount: 1,
    createdAt: '2026-09-01T00:00:00Z',
    version: 0,
  },
  {
    id: 'p-sales',
    name: '영업',
    color: 'P2',
    archived: false,
    taskCount: 2,
    openTaskCount: 1,
    createdAt: '2026-09-01T00:00:00Z',
    version: 0,
  },
]

const day = (date: string, completedTaskCount: number) => ({
  date,
  completedTaskCount,
  recordCount: completedTaskCount,
})

const REPORT: Stats = {
  from: '2026-10-01',
  to: '2026-10-31',
  completedTaskCount: 12,
  recordCount: 30,
  confirmedLogCount: 5,
  daily: Array.from({ length: 31 }, (_, i) =>
    day(`2026-10-${String(i + 1).padStart(2, '0')}`, i === 1 ? 4 : i === 6 ? 8 : 0),
  ),
  projects: [
    { projectId: 'p-dev', completedTaskCount: 9, recordCount: 20 },
    { projectId: null, completedTaskCount: 3, recordCount: 5 },
    { projectId: 'p-sales', completedTaskCount: 0, recordCount: 5 },
  ],
  firstRecordDate: '2026-09-01',
}

const PLAN: PlanVsActual = {
  from: '2026-09-28',
  to: '2026-11-01',
  weeks: [
    { weekStart: '2026-09-28', plannedMin: 600, actualMin: 780, unplannedMin: 60 },
    { weekStart: '2026-10-05', plannedMin: 0, actualMin: 0, unplannedMin: 0 },
    { weekStart: '2026-10-12', plannedMin: 0, actualMin: 0, unplannedMin: 45 },
  ],
  topDiffs: [{ taskId: 't-1', title: '결제 API 설계', projectId: 'p-dev', plannedMin: 360, actualMin: 540 }],
}

const settings = (timeTrackingEnabled: boolean) => () =>
  json(200, {
    userId: 'u-1',
    settings: {
      timeTrackingEnabled,
      workHoursStart: '09:00',
      workHoursEnd: '18:00',
      dailyCloseTime: '18:00',
      version: 0,
    },
  })

function setup(stats: () => Response, timeTracking = false) {
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: PROJECTS }),
    'GET /api/worklog/me': settings(timeTracking),
    'GET /api/worklog/stats': stats,
    'GET /api/worklog/stats/plan-vs-actual': () => json(200, PLAN),
    'GET /api/worklog/records/time-summary': () =>
      json(200, {
        from: '2026-10-01',
        to: '2026-10-31',
        totalMin: 600,
        recordCount: 4,
        projects: [
          { projectId: 'p-dev', minutes: 450 },
          { projectId: 'p-sales', minutes: 150 },
        ],
        tasks: [],
      }),
  })
  const result = renderApp('/stats', [
    { path: '/stats', element: <StatsPage /> },
    { path: '*', element: <p>다른 화면</p> },
  ])
  return { fetchMock, ...result }
}

const statsCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/worklog/stats'))

describe('SCR-STAT-01 통계', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('기본은 이번 달: 요약·주별 표·프로젝트 링크, 시간 기록이 꺼져 있으면 회고 대신 켜기 안내', async () => {
    const { fetchMock } = setup(() => json(200, REPORT))
    const summary = await screen.findByRole('list', { name: '요약' })
    expect(within(summary).getByText('12')).toBeInTheDocument()
    expect(within(summary).getByText('5')).toBeInTheDocument()
    expect(statsCalls(fetchMock)).toEqual(['/api/worklog/stats?from=2026-10-01&to=2026-10-31'])
    expect(screen.getByRole('button', { name: '이번 달' })).toHaveAttribute('aria-pressed', 'true')

    const table = screen.getByRole('table', { name: '주별 완료 업무' })
    expect(within(table).getByRole('row', { name: '10/5–10/11 8건' })).toBeInTheDocument()

    expect(await screen.findByRole('link', { name: /개발\s*9건/ })).toHaveAttribute(
      'href',
      '/tasks?status=DONE&project=p-dev',
    )
    // 프로젝트 없는 업무는 거를 조건이 없어 링크가 아니다. 완료 없이 기록만 있는 프로젝트는 빠진다
    expect(screen.getByText('프로젝트 없음').closest('a')).toBeNull()
    expect(screen.queryByText('영업')).not.toBeInTheDocument()
    expect(statsCalls(fetchMock).filter((u) => u.includes('plan-vs-actual'))).toEqual([])

    expect(screen.getByRole('link', { name: '기록 옵션 열기' })).toHaveAttribute('href', '/settings/recording')
    expect(screen.queryByText('소요시간 비중')).not.toBeInTheDocument()
  })

  it('시간 기록이 켜져 있으면 소요시간 비중과 예상 대비 실제', async () => {
    const { fetchMock } = setup(() => json(200, REPORT), true)
    expect(await screen.findByText('개발 7.5시간 (75%)')).toBeInTheDocument()
    expect(screen.getByText('영업 2.5시간 (25%)')).toBeInTheDocument()
    const region = await screen.findByRole('region', { name: '주별 예상 대비 실제 표' })
    expect(statsCalls(fetchMock)).toContain('/api/worklog/stats/plan-vs-actual?from=2026-09-28&to=2026-11-01')
    expect(region).toHaveAttribute('tabindex', '0')
    expect(
      within(region)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['주', '예상', '실제', '차이', '계획 밖'])
    expect(within(region).getByRole('row', { name: '9/28–10/4 10시간 13시간 +3시간 1시간' })).toBeInTheDocument()
    // 아무것도 없는 주는 빼고, 계획 밖만 있는 주는 보인다(TC-P4Q-STAT-01)
    expect(within(region).queryByRole('row', { name: /^10\/5–/ })).toBeNull()
    expect(within(region).getByRole('row', { name: /^10\/12–10\/18 .* 45분$/ })).toBeInTheDocument()
    expect(screen.getByText(/일정에 잡지 않고 한 일은 '계획 밖'에 따로 모아요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /결제 API 설계/ })).toHaveAttribute('href', '/tasks/t-1')
  })

  it('가입 1주일 전이면 남은 날과 홈으로', async () => {
    setup(() => json(200, { ...REPORT, firstRecordDate: '2026-10-05' }))
    expect(await screen.findByRole('heading', { name: '1주일 기록이 쌓이면 보여 드려요' })).toBeInTheDocument()
    expect(screen.getByText(/앞으로 4일 남았어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/')
  })

  it('고른 기간에 아무것도 없으면 다른 기간 안내', async () => {
    setup(() =>
      json(200, { ...REPORT, completedTaskCount: 0, recordCount: 0, confirmedLogCount: 0, daily: [], projects: [] }),
    )
    expect(await screen.findByRole('heading', { name: '이 기간에는 기록이 없어요' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '요약' })).not.toBeInTheDocument()
  })

  it('못 받으면 다시 시도', async () => {
    let fail = true
    const { fetchMock } = setup(() => (fail ? problem(500, 'INTERNAL') : json(200, REPORT)))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('통계를 불러오지 못했어요')
    fail = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('list', { name: '요약' })).toBeInTheDocument()
    expect(statsCalls(fetchMock)).toHaveLength(2)
  })

  it('이번 주로 바꾸면 주 시작 요일부터 다시 받는다', async () => {
    const { fetchMock, router } = setup(() => json(200, REPORT))
    await screen.findByRole('list', { name: '요약' })
    await userEvent.click(screen.getByRole('button', { name: '이번 주' }))
    await waitFor(() => expect(statsCalls(fetchMock)).toContain('/api/worklog/stats?from=2026-10-05&to=2026-10-11'))
    expect(router.state.location.search).toBe('?period=week')
    expect(screen.getByRole('button', { name: '이번 주' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('직접 선택: 틀린 기간은 알리고, 적용하면 버튼에 기간을 보인다. 닫으면 버튼으로 포커스', async () => {
    const { fetchMock, router } = setup(() => json(200, REPORT))
    await screen.findByRole('list', { name: '요약' })
    const opener = screen.getByRole('button', { name: '직접 선택' })
    await userEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: '기간 고르기' })
    const start = within(dialog).getByLabelText('시작일')
    expect(start).toHaveFocus()

    fireEvent.change(start, { target: { value: '2026-11-20' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '적용' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('시작일을 종료일보다 앞으로 골라 주세요')
    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(start).toHaveAccessibleDescription('시작일을 종료일보다 앞으로 골라 주세요')

    await userEvent.click(within(dialog).getByRole('button', { name: '지난달' }))
    expect(within(dialog).getByRole('alert')).toBeEmptyDOMElement()
    await userEvent.click(within(dialog).getByRole('button', { name: '적용' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?period=custom&from=2026-09-01&to=2026-09-30')
    const custom = screen.getByRole('button', { name: '직접 선택 9/1–9/30' })
    expect(custom).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(statsCalls(fetchMock)).toContain('/api/worklog/stats?from=2026-09-01&to=2026-09-30'))

    await userEvent.click(custom)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(custom).toHaveFocus()
  })

  it('큰 수는 천 단위로 끊고, 다시 받다 실패해도 받아 둔 내용은 둔다', async () => {
    let fail = false
    const { queryClient } = setup(() =>
      fail ? problem(500, 'INTERNAL') : json(200, { ...REPORT, recordCount: 12345 }),
    )
    expect(await screen.findByText('12,345')).toBeInTheDocument()
    fail = true
    await queryClient.refetchQueries({ queryKey: ['stats'] })
    expect(screen.getByText('12,345')).toBeInTheDocument()
    expect(screen.queryByText('통계를 불러오지 못했어요')).not.toBeInTheDocument()
  })
})

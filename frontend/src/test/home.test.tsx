import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Occurrence } from '../calendar/api'
import type { Task } from '../tasks/api'
import { json, ME, renderApp, stubFetch } from './renderApp'

// 서울 2026-10-07(수) 12:00. 10-09(금)은 한글날
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const PROJECTS = [
  {
    id: 'p-sales',
    name: '영업',
    color: 'P2',
    archived: false,
    taskCount: 2,
    openTaskCount: 1,
    createdAt: '2026-10-01T00:00:00Z',
    version: 0,
  },
]

const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
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
  ...extra,
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

const REMAINING = [
  task('late', '9월 매출 보고서', { dueDate: '2026-10-06', projectId: 'p-sales' }),
  task('today', '견적서 작성', { dueDate: '2026-10-07' }),
  task('week', '결제 API 문서화', { dueDate: '2026-10-08' }),
  task('none', '온보딩 자료 정리'),
]
const DONE = [task('d1', '스탠드업 준비', { status: 'DONE', completedAt: '2026-10-06T01:00:00Z' })]
const OCCURRENCES = [
  // 오늘 09:00–10:00(끝남), 오늘 15:00–16:00(남음), 내일 10:00–11:30
  occurrence('s1', '데일리 스탠드업', '2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z'),
  occurrence('s2', '고객사 미팅', '2026-10-07T06:00:00Z', '2026-10-07T07:00:00Z'),
  occurrence('s3', '스프린트 리뷰', '2026-10-08T01:00:00Z', '2026-10-08T02:30:00Z'),
]

function server(options: { remaining?: Task[]; occurrences?: Occurrence[]; holdTasks?: boolean } = {}) {
  // 완료(PATCH)하면 남은 업무 응답에서 빠진다
  const remaining = (options.remaining ?? REMAINING).map((t) => ({ ...t }))
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = []
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: PROJECTS }),
    'GET /api/worklog/schedules': () => json(200, { items: options.occurrences ?? OCCURRENCES }),
  })
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/worklog/tasks')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      calls.push({ method, url, body })
      if (method === 'GET') {
        // 응답을 끝내 주지 않아 불러오는 중 상태를 본다
        if (options.holdTasks) return new Promise<Response>(() => {})
        const done = new URLSearchParams(url.split('?')[1]).getAll('status').includes('DONE')
        return json(200, { items: done ? DONE : remaining.filter((t) => t.status !== 'DONE'), nextCursor: null })
      }
      const target = remaining.find((t) => t.id === url.split('/').pop())!
      Object.assign(target, body, { version: target.version + 1 })
      return json(200, target)
    }
    return base(input, init)
  })
  return { calls }
}

describe('SCR-HOME-01 홈 대시보드 1차', () => {
  it('요약 카드: 남은 업무(마감 초과)·오늘 일정(남은 수)·이번 주 완료, 누르면 해당 목록으로 간다', async () => {
    server()
    renderApp('/')
    const cards = await screen.findByRole('list', { name: '요약' })
    await waitFor(() =>
      expect(within(cards).getByRole('link', { name: /남은 업무/ })).toHaveTextContent('남은 업무4마감 초과 1건'),
    )
    expect(within(cards).getByRole('link', { name: /오늘 일정/ })).toHaveTextContent('오늘 일정21개 남았어요')
    expect(within(cards).getByRole('link', { name: /오늘 일정/ })).toHaveAttribute('href', '/calendar/day/2026-10-07')
    expect(within(cards).getByRole('link', { name: /이번 주 완료/ })).toHaveTextContent('이번 주 완료110/5(월)부터')
    // P1-11-02 이번 주 완료 카드는 같은 조건(완료·이번 주부터)의 목록으로
    expect(within(cards).getByRole('link', { name: /이번 주 완료/ })).toHaveAttribute(
      'href',
      '/tasks?status=DONE&completed=week',
    )
    // 확인 대기 카드는 P2
    expect(within(cards).queryByText('확인 대기')).not.toBeInTheDocument()
  })

  it('P1-11-07 불러오는 동안 카드에 "없음"을 먼저 보이지 않고 숫자·보조 문구를 스켈레톤으로 둔다', async () => {
    server({ holdTasks: true })
    renderApp('/')
    const card = within(await screen.findByRole('list', { name: '요약' })).getByRole('link', { name: /남은 업무/ })
    await waitFor(() => expect(within(card).getAllByRole('status')).toHaveLength(2))
    expect(card).not.toHaveTextContent('마감 초과 없음')
    expect(card).not.toHaveTextContent(/\d/)
  })

  it('남은 업무는 마감 초과 → 오늘 → 이번 주로 묶고, 날짜 없는 업무는 접어 둔다', async () => {
    server()
    renderApp('/')
    const section = await screen.findByRole('region', { name: '남은 업무' })
    expect(await within(section).findByRole('heading', { name: '마감 초과 1' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: '오늘 1' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: '이번 주 1' })).toBeInTheDocument()
    expect(within(section).queryByText('온보딩 자료 정리')).not.toBeInTheDocument()

    const toggle = within(section).getByRole('button', { name: '날짜 없는 업무 1개' })
    await userEvent.click(toggle)
    expect(within(section).getByText('온보딩 자료 정리')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveFocus()

    await userEvent.click(within(section).getByRole('button', { name: '프로젝트' }))
    expect(within(section).getByRole('heading', { name: '영업 1' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: '프로젝트 없음 3' })).toBeInTheDocument()
  })

  it('완료 체크는 바로 완료하고 되돌리기 토스트를 띄운다', async () => {
    const { calls } = server()
    renderApp('/')
    await userEvent.click(await screen.findByRole('checkbox', { name: '견적서 작성 완료' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        url: '/api/worklog/tasks/today',
        body: { version: 0, status: 'DONE' },
      }),
    )
    expect(await screen.findByText('업무 1개를 완료했어요')).toBeInTheDocument()
  })

  it('완료한 행이 빠지면 포커스를 다음 행의 완료 체크로 옮긴다 (BODY로 빠지지 않음)', async () => {
    server()
    renderApp('/')
    const check = await screen.findByRole('checkbox', { name: '견적서 작성 완료' })
    check.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByText('견적서 작성')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '결제 API 문서화 완료' })).toHaveFocus())
  })

  it('다가오는 일정은 오늘 남은 일정부터 7일, 공휴일을 함께 보여 준다', async () => {
    server()
    renderApp('/')
    const section = await screen.findByRole('region', { name: '다가오는 일정' })
    // 공휴일은 일정 응답 전에도 보이므로 일정까지 들어올 때를 기다린다
    await waitFor(() =>
      expect(
        within(section)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual([
        '오늘710/7(수) 고객사 미팅15:00 – 16:00',
        '목810/8(목) 스프린트 리뷰10:00 – 11:30',
        '금910/9(금) 한글날공휴일',
      ]),
    )
    const items = within(section).getAllByRole('link')
    // 이미 끝난 오늘 일정은 뺀다
    expect(within(section).queryByText('데일리 스탠드업')).not.toBeInTheDocument()
    expect(items[1]).toHaveAttribute('href', '/calendar/day/2026-10-08')
  })

  it('업무가 하나도 없으면 남은 업무 대신 첫 실행 안내를 보여 준다', async () => {
    server({ remaining: [], occurrences: [] })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: '오늘 할 일을 한 줄로 적어 보세요' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '남은 업무' })).not.toBeInTheDocument()
  })

  it('7일 안에 일정도 공휴일도 없으면 비었다고 알린다', async () => {
    // 10-12(월)부터 7일 안에는 공휴일이 없다
    vi.setSystemTime(new Date('2026-10-12T03:00:00Z'))
    server({ remaining: [], occurrences: [] })
    renderApp('/')
    expect(await screen.findByText('7일 안에 잡힌 일정이 없어요')).toBeInTheDocument()
  })
})

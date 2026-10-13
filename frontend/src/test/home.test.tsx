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

function server(
  options: {
    remaining?: Task[]
    occurrences?: Occurrence[]
    holdTasks?: boolean
    log?: Record<string, unknown>
    periods?: Record<string, unknown>[]
    failDone?: () => boolean
  } = {},
) {
  // 완료(PATCH)하면 남은 업무 응답에서 빠진다
  const remaining = (options.remaining ?? REMAINING).map((t) => ({ ...t }))
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = []
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: PROJECTS }),
    'GET /api/worklog/schedules': () => json(200, { items: options.occurrences ?? OCCURRENCES }),
    ...(options.log && { 'GET /api/worklog/logs/daily/2026-10-07': () => json(200, options.log) }),
    ...(options.periods && {
      'GET /api/worklog/logs': () => json(200, { items: options.periods, unconfirmedDays: 0 }),
    }),
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
        if (done && options.failDone?.()) return json(500, { title: 'boom' })
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
  it('UX-HOME-150 이번 주 완료만 실패하면 "—" 대신 불러오지 못했다고 말하고 [다시]로 다시 부른다', async () => {
    const user = userEvent.setup()
    let fail = true
    server({ failDone: () => fail })
    renderApp('/')
    const cards = await screen.findByRole('list', { name: '요약' })
    const link = await within(cards).findByRole('link', { name: /이번 주 완료\s*불러오지 못했어요/ })
    expect(link).not.toHaveTextContent('—')
    fail = false
    await user.click(within(cards).getByRole('button', { name: '이번 주 완료 다시 불러오기' }))
    await waitFor(() =>
      expect(within(cards).getByRole('link', { name: /이번 주 완료/ })).toHaveTextContent('이번 주 완료1'),
    )
    expect(within(cards).queryByRole('button', { name: '이번 주 완료 다시 불러오기' })).not.toBeInTheDocument()
  })

  it('UX-HOME-02 요약 한 줄: 남은 업무(초과 n)·오늘 일정(남은 n)·확인 대기·이번 주 완료, 누르면 해당 목록으로 간다', async () => {
    server()
    renderApp('/')
    const cards = await screen.findByRole('list', { name: '요약' })
    await waitFor(() =>
      expect(within(cards).getByRole('link', { name: /남은 업무/ })).toHaveTextContent('남은 업무4초과 1'),
    )
    expect(within(cards).getByRole('link', { name: /오늘 일정/ })).toHaveTextContent('오늘 일정2남은 1')
    expect(within(cards).getByRole('link', { name: /오늘 일정/ })).toHaveAttribute('href', '/calendar/day/2026-10-07')
    expect(within(cards).getByRole('link', { name: /이번 주 완료/ })).toHaveTextContent('이번 주 완료1')
    // P1-11-02 이번 주 완료는 같은 조건(완료·이번 주부터)의 목록으로
    expect(within(cards).getByRole('link', { name: /이번 주 완료/ })).toHaveAttribute(
      'href',
      '/tasks?status=DONE&completed=week',
    )
    // 확인 대기(P2-03). 자세한 동작은 pendingRecords.test.tsx
    expect(within(cards).getByRole('button', { name: /확인 대기/ })).toHaveTextContent('확인 대기0')
  })

  it('P1-11-07 불러오는 동안 요약에 "없음"·0을 먼저 보이지 않고 숫자를 스켈레톤으로 둔다', async () => {
    server({ holdTasks: true })
    renderApp('/')
    const card = within(await screen.findByRole('list', { name: '요약' })).getByRole('link', { name: /남은 업무/ })
    await waitFor(() => expect(card.querySelectorAll('[data-skeleton]')).toHaveLength(1))
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

  it('UX-HOME-11 남은 업무는 앞 10개만 그리고, 묶음 제목은 전체 수, 링크는 "n개 더 보기"', async () => {
    const many = Array.from({ length: 13 }, (_, i) => task(`t${i}`, `오늘 업무 ${i + 1}`, { dueDate: '2026-10-07' }))
    server({ remaining: [...many, task('n1', '날짜 없는 일')] })
    renderApp('/')
    const section = await screen.findByRole('region', { name: '남은 업무' })
    expect(await within(section).findByRole('heading', { name: '오늘 13' })).toBeInTheDocument()
    expect(within(section).getAllByRole('checkbox')).toHaveLength(10)
    expect(within(section).getByRole('link', { name: '업무 3개 더 보기' })).toHaveAttribute('href', '/tasks')
    // 날짜 없는 업무는 상한 밖: 펼치면 상한에 걸려 있어도 보인다
    within(section).getByRole('button', { name: '날짜 없는 업무 1개' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(within(section).getByText('날짜 없는 일')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '견적서 작성 완료' })).not.toBeInTheDocument())
    // 결과 팝오버(SCR-TASK-03)가 포커스를 가져가고, Esc(건너뛰기)로 닫으면 다음 행으로 간다
    expect(screen.getByRole('textbox', { name: '결과 한 줄' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '결제 API 문서화 완료' })).toHaveFocus())
  })

  it('UX-HOME-10 다가오는 일정은 내일부터 7일, 공휴일을 함께 보여 준다(오늘 일정은 요약·오늘 칸에서만)', async () => {
    server()
    renderApp('/')
    const section = await screen.findByRole('region', { name: '다가오는 일정' })
    // 공휴일은 일정 응답 전에도 보이므로 일정까지 들어올 때를 기다린다
    await waitFor(() =>
      expect(
        within(section)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['목810/8(목) 스프린트 리뷰10:00 – 11:30', '금910/9(금) 한글날공휴일']),
    )
    const items = within(section).getAllByRole('link')
    expect(within(section).queryByText('고객사 미팅')).not.toBeInTheDocument()
    expect(items[0]).toHaveAttribute('href', '/calendar/day/2026-10-08')
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

describe('하루 마감 띠 (X-02 C, UX-HOME-04·12)', () => {
  // 지난 일간 일지 목록(GET /logs?type=DAILY). 오늘은 2026-10-07(수)
  const day = (periodStart: string, status: string, workday = true) => ({
    type: 'DAILY',
    periodStart,
    periodEnd: periodStart,
    logId: status === 'NO_RECORDS' ? null : `log-${periodStart}`,
    status,
    workday,
    holiday: null,
  })

  it('UX-M-HOME-03 마감 시각 전에는 미확정인 가장 최근 근무일을 띠로 알리고, [하루 마감]은 그날 마감 창을 연다', async () => {
    server({ periods: [day('2026-10-05', 'CONFIRMED'), day('2026-10-06', 'DRAFT')] })
    renderApp('/')
    const band = await screen.findByRole('region', { name: '하루 마감' })
    expect(band).toHaveTextContent('10/6(화) 하루 마감을 아직 하지 않았어요')
    // 오늘 마감 카드의 [하루 마감]과 이름이 겹치지 않는다(UX-M-HOME-101)
    expect(screen.getAllByRole('button', { name: '하루 마감' })).toHaveLength(1)
    await userEvent.click(within(band).getByRole('button', { name: '10/6(화) 하루 마감' }))
    // 그날(10/6) 마감 창이 그날 계획을 받는다
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/logs/daily/2026-10-06/close'))).toBe(
        true,
      ),
    )
  })

  it('UX-M-HOME-03 가장 최근 근무일을 마감했으면 그 앞의 미확정은 알리지 않고, 기록 없는 비근무일은 건너뛴다', async () => {
    server({
      periods: [day('2026-10-02', 'DRAFT'), day('2026-10-05', 'CONFIRMED'), day('2026-10-06', 'NO_RECORDS', false)],
    })
    renderApp('/')
    await screen.findByRole('list', { name: '요약' })
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/worklog/logs?'))).toBe(true),
    )
    expect(screen.queryByRole('region', { name: '하루 마감' })).not.toBeInTheDocument()
  })

  it('UX-M-HOME-03 오늘 마감 시각부터는 오늘 띠가 넘겨받는다(띠는 하나)', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z')) // 서울 19:00
    server({ periods: [day('2026-10-06', 'DRAFT')] })
    renderApp('/')
    const band = await screen.findByRole('region', { name: '하루 마감' })
    expect(band).toHaveTextContent('오늘 기록을 정리할 시간이에요')
    expect(screen.getAllByRole('region', { name: '하루 마감' })).toHaveLength(1)
  })

  it('업무일지 숨김: 하루 마감 알림·푸시의 옛 주소(/logs/daily/{날짜}?close=1)는 홈으로 바꾸고 그날 마감 창을 연다', async () => {
    server()
    const { router } = renderApp('/logs/daily/2026-10-06?close=1')
    // 그날(10/6) 마감 창이 열린다
    expect(await screen.findByRole('dialog', { name: /^10월 6일 하루 마감/ })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/logs/daily/2026-10-06'))).toBe(true)
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('')
  })

  it('마감 시각 전에는 띠가 없고 빠른 입력 안내는 할 일, 오늘 마감 카드에 [하루 마감]이 있다', async () => {
    server()
    renderApp('/')
    expect(await screen.findByPlaceholderText('무엇을 할지 한 줄로 적어 보세요')).toBeInTheDocument()
    await screen.findByRole('list', { name: '요약' })
    expect(screen.queryByRole('region', { name: '하루 마감' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '하루 마감' })).toBeInTheDocument()
  })

  it('마감 시각(18:00)이 지나면 머리 아래 띠의 [하루 마감] 하나만 남고, 안내는 한 일로 바뀐다', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z')) // 서울 19:00
    server()
    renderApp('/')
    const band = await screen.findByRole('region', { name: '하루 마감' })
    expect(band).toHaveTextContent('오늘 기록을 정리할 시간이에요')
    expect(within(band).getByRole('button', { name: '하루 마감' })).toHaveAttribute('aria-haspopup', 'dialog')
    // 오늘 마감 카드의 [하루 마감]은 숨긴다(채움은 띠 하나)
    expect(screen.getAllByRole('button', { name: '하루 마감' })).toHaveLength(1)
    expect(screen.getByPlaceholderText('무엇을 했는지 한 줄로 적어 보세요')).toBeInTheDocument()
  })

  it('오늘 마감했으면 띠는 마감 한 줄로 바뀌고, 일지로 가는 링크는 띠·카드 어디에도 없다(업무일지 숨김)', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
    server({
      log: {
        id: 'log-1',
        type: 'DAILY',
        periodStart: '2026-10-07',
        periodEnd: '2026-10-07',
        status: 'CONFIRMED',
        version: 2,
        confirmedAt: '2026-10-07T09:40:00Z',
        sourceChangedAfterConfirm: false,
        planCandidates: [],
        content: {
          title: '업무일지',
          planTitle: '내일 계획',
          planPeriod: { start: '2026-10-08', end: '2026-10-08' },
          author: { name: null, organization: null, position: null },
          achievementsAuto: true,
          achievements: [],
          plans: [{ id: 'pl-1', text: '견적서 보내기', taskId: null, projectId: null }],
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
      },
    })
    renderApp('/')
    const band = await screen.findByRole('region', { name: '하루 마감' })
    expect(band).toHaveTextContent('✓ 오늘 하루를 마감했어요18:40 마감 · 내일 계획 1건')
    expect(within(band).queryByRole('button')).not.toBeInTheDocument()
    expect(within(band).queryByRole('link')).not.toBeInTheDocument()
    expect(await screen.findByText('18:40에 마감했어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '일지 보기' })).not.toBeInTheDocument()
  })
})

describe('오프라인 (SCR-SYS-02 ③, P1-X-04)', () => {
  it('끊긴 동안 빠른 기록·완료 체크를 막고, 묶기 전환·요약 링크는 된다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    server()
    renderApp('/')
    expect(await screen.findByRole('checkbox', { name: '견적서 작성 완료' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '빠른 기록' })).toBeDisabled()
    const section = screen.getByRole('region', { name: '남은 업무' })
    await userEvent.click(within(section).getByRole('button', { name: '프로젝트' }))
    expect(within(section).getByRole('heading', { name: '영업 1' })).toBeInTheDocument()
  })
})

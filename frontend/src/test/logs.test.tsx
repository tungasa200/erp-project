// 업무일지 화면 (SCR-LOG-01·02, P3-06·08): 자동/고정 알약, 첫 실적 수정 → 고정 알림, 다시 채우기·확정·해제 대화상자, 목록 미작성 → 초안
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogPeriod, WorkLog } from '../logs/api'
import { DayClose } from '../logs/DayClose'
import { TodayLogCard, WeekLogStatus } from '../logs/HomeLogCards'
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

// 프로필이 다 차 있어 프로필 입력 요청(SCR-ONB-01)은 뜨지 않는다. 그 창은 profilePrompt.test.tsx
const me = () => json(200, { ...ME, name: '김하늘', organization: '개발팀', position: '매니저' })

function workLog(extra: Partial<WorkLog> = {}, content: Partial<WorkLog['content']> = {}): WorkLog {
  return {
    id: 'log-1',
    type: 'DAILY',
    periodStart: '2026-10-07',
    periodEnd: '2026-10-07',
    status: 'DRAFT',
    version: 0,
    confirmedAt: null,
    sourceChangedAfterConfirm: false,
    planCandidates: [],
    ...extra,
    content: {
      title: '업무일지',
      planTitle: '내일 계획',
      planPeriod: { start: '2026-10-08', end: '2026-10-08' },
      author: { name: '김하늘', organization: null, position: null },
      days: [],
      achievementsAuto: true,
      achievements: [
        {
          id: 'a-1',
          source: 'RECORD',
          text: '견적서 작성',
          result: '초안 완료',
          outcome: 'DONE',
          progress: null,
          taskId: null,
          projectName: null,
          recordIds: ['r-1'],
          dates: ['2026-10-07'],
          durationMin: null,
        },
      ],
      plans: [],
      issues: null,
      metrics: {
        recordCount: 1,
        done: 1,
        reviewRequested: 0,
        inProgress: 0,
        completedTaskCount: 0,
        pendingCount: 0,
        totalMin: null,
      },
      projects: [],
      time: null,
      ...content,
    },
  }
}

const LOG_URL = 'GET /api/worklog/logs/daily/2026-10-07'
// 400 VALIDATION_FAILED 한 칸
const problemJson = (field: string, code: string) => problem(400, 'VALIDATION_FAILED', { errors: [{ field, code }] })

describe('일지 상세 (SCR-LOG-02)', () => {
  it('자동 초안: 알약 "실적 자동", 다시 채우기 없음. 실적을 처음 고치면 고정으로 바뀌고 한 번 알린다', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | null = null
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': (init) => {
        patched = JSON.parse(String(init?.body))
        return json(
          200,
          workLog(
            { version: 1 },
            { achievementsAuto: false, achievements: (patched as { achievements: never }).achievements },
          ),
        )
      },
    })
    renderApp('/logs/daily/2026-10-07')

    const pill = await screen.findByText('실적 자동')
    expect(pill).toHaveAccessibleDescription(/원본이 바뀌면 함께 바뀌어요/)
    expect(screen.queryByRole('button', { name: '원본에서 다시 채우기' })).not.toBeInTheDocument()

    const result = screen.getByRole('textbox', { name: '1번 결과' })
    await user.clear(result)
    await user.type(result, '발송 완료')

    await waitFor(() => expect(patched).not.toBeNull(), { timeout: 3000 })
    expect(patched).toMatchObject({ version: 0, achievements: [{ id: 'a-1', result: '발송 완료' }] })
    await waitFor(() =>
      expect(screen.getByText('실적을 고정했어요. 원본이 바뀌어도 그대로예요')).toHaveAttribute('role', 'status'),
    )
    expect(screen.getByText('실적 고정')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '원본에서 다시 채우기' })).toBeInTheDocument()
  })

  it('고정 초안 다시 채우기: 취소에 먼저 포커스, Esc로 닫고 버튼으로 복귀, 확인하면 토스트', async () => {
    const user = userEvent.setup()
    const refill = vi.fn(() => json(200, workLog({ version: 3 })))
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog({ version: 2 }, { achievementsAuto: false })),
      'POST /api/worklog/logs/log-1/refill': refill,
    })
    renderApp('/logs/daily/2026-10-07')

    const open = await screen.findByRole('button', { name: '원본에서 다시 채우기' })
    await user.click(open)
    const dialog = screen.getByRole('alertdialog', { name: '원본에서 다시 채울까요?' })
    expect(dialog).toHaveTextContent('직접 고친 실적이 지금 기록으로 바뀌어요. 계획과 이슈는 그대로예요.')
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(open).toHaveFocus())

    await user.click(open)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '다시 채우기' }))
    expect(await screen.findByText('실적을 원본에서 다시 채웠어요')).toBeInTheDocument()
    expect(refill.mock.calls[0]).toBeDefined()
    expect(screen.getByText('실적 자동')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('확정 → 확정 해제: 버튼이 바뀌면 제목으로 포커스, 해제 안내 문구, 확정 일지는 알약 없음', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'POST /api/worklog/logs/log-1/confirm': () =>
        json(200, workLog({ status: 'CONFIRMED', version: 1, confirmedAt: '2026-10-07T09:00:00Z' })),
      'POST /api/worklog/logs/log-1/unconfirm': () => json(200, workLog({ version: 2 }, { achievementsAuto: false })),
    })
    renderApp('/logs/daily/2026-10-07')

    await user.click(await screen.findByRole('button', { name: '확정' }))
    expect(await screen.findByText('일지를 확정했어요')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(screen.queryByText(/실적 (자동|고정)/)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '1번 결과' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '확정 해제' }))
    const dialog = screen.getByRole('alertdialog', { name: '확정을 해제할까요?' })
    expect(dialog).toHaveTextContent(
      "확정본 내용이 그대로 초안이 되고, 원본 기록을 다시 반영하려면 '원본에서 다시 채우기'를 쓰세요.",
    )
    await user.click(within(dialog).getByRole('button', { name: '확정 해제' }))
    expect(await screen.findByText('확정을 해제했어요. 초안으로 고칠 수 있어요')).toBeInTheDocument()
    expect(screen.getByText('실적 고정')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '1번 결과' })).toBeInTheDocument()
  })

  it('미리보기(id 없음)를 고치면 초안을 만든 뒤 저장한다', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog({ id: null, status: 'NOT_WRITTEN' })),
      'POST /api/worklog/logs/daily/2026-10-07': () => {
        calls.push('create')
        return json(201, workLog())
      },
      'PATCH /api/worklog/logs/log-1': () => {
        calls.push('patch')
        return json(200, workLog({ version: 1 }, { issues: '회의 연기' }))
      },
    })
    renderApp('/logs/daily/2026-10-07')

    await user.type(await screen.findByRole('textbox', { name: '이슈 및 특이사항' }), '회의 연기')
    await waitFor(() => expect(calls).toEqual(['create', 'patch']), { timeout: 3000 })
  })

  it('[실적에 넣기]를 누르면 다음 기록의 버튼으로, 마지막이면 추가된 실적 줄로 포커스가 간다', async () => {
    const user = userEvent.setup()
    const record = (id: string, content: string) => ({
      id,
      content,
      workDate: '2026-10-07',
      status: 'CONFIRMED',
      result: null,
      outcome: null,
      progress: null,
      taskId: null,
      projectId: null,
    })
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/records': () =>
        json(200, { items: [record('r-2', '회의 준비'), record('r-3', '자료 정리')], nextCursor: null }),
      'PATCH /api/worklog/logs/log-1': (init) =>
        json(200, workLog({ version: 1 }, { achievementsAuto: false, ...JSON.parse(String(init?.body)) })),
    })
    renderApp('/logs/daily/2026-10-07')

    await user.click(await screen.findByRole('button', { name: '회의 준비 실적에 넣기' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '자료 정리 실적에 넣기' })).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('textbox', { name: '3번 업무 내용' })).toHaveFocus())
    expect(screen.getByRole('textbox', { name: '3번 업무 내용' })).toHaveValue('자료 정리')
  })

  it('편집 칸은 줄바꿈되는 여러 줄 칸이고, Enter·붙여 넣은 줄바꿈은 넣지 않는다', async () => {
    const user = userEvent.setup()
    stubFetch({ 'GET /api/users/me': me, [LOG_URL]: () => json(200, workLog()) })
    renderApp('/logs/daily/2026-10-07')

    const text = await screen.findByRole('textbox', { name: '1번 업무 내용' })
    expect(text.tagName).toBe('TEXTAREA')
    await user.type(text, '{Enter}추가')
    await user.paste('\n붙임')
    expect(text).toHaveValue('견적서 작성추가 붙임')
  })

  it('잘못된 주소는 찾을 수 없다고 알리고 목록 링크를 준다', async () => {
    stubFetch({ 'GET /api/users/me': me })
    renderApp('/logs/daily/2026-13-40')
    expect(await screen.findByRole('heading', { name: '일지를 찾을 수 없어요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '일지 목록으로' })).toHaveAttribute('href', '/logs')
  })
})

const period = (date: string, status: LogPeriod['status'], extra: Partial<LogPeriod> = {}): LogPeriod => ({
  type: 'DAILY',
  periodStart: date,
  periodEnd: date,
  status,
  logId: status === 'DRAFT' || status === 'CONFIRMED' ? `log-${date}` : null,
  workday: true,
  holiday: null,
  ...extra,
})

function october(): LogPeriod[] {
  return Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, '0')}`
    if (date === '2026-10-03') return period(date, 'NO_RECORDS', { workday: false, holiday: '개천절' })
    if (date === '2026-10-06') return period(date, 'CONFIRMED')
    if (date === '2026-10-07') return period(date, 'NOT_WRITTEN')
    return period(date, 'NO_RECORDS')
  })
}

describe('일지 목록 (SCR-LOG-01)', () => {
  it('일간 달력: 상태·공휴일, 확정 안 된 날 띠, 미작성 날을 누르면 초안을 만들고 연다', async () => {
    const user = userEvent.setup()
    const create = vi.fn(() => json(201, workLog()))
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs': () => json(200, { items: october(), unconfirmedDays: 1 }),
      'POST /api/worklog/logs/daily/2026-10-07': create,
      [LOG_URL]: () => json(200, workLog()),
    })
    const { router } = renderApp('/logs')

    expect(await screen.findByRole('heading', { name: '2026년 10월' })).toBeInTheDocument()
    expect(await screen.findByText('확정 안 된 날 1일')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /10월 6일.*확정/ })).toHaveAttribute('href', '/logs/daily/2026-10-06')
    expect(screen.getByText('개천절')).toBeInTheDocument()

    const draft = screen.getByRole('button', { name: /10월 7일.*미작성 — 초안 만들기/ })
    draft.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/logs/daily/2026-10-07'))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('주간 탭: 행에 확정 n/m일, 이전 달로 넘기면 주소가 바뀐다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs': (init) => {
        void init
        return json(200, {
          items: [
            period('2026-10-05', 'DRAFT', {
              type: 'WEEKLY',
              periodEnd: '2026-10-11',
              days: { confirmed: 1, workdays: 5 },
            }),
          ],
          unconfirmedDays: 0,
        })
      },
    })
    const { router } = renderApp('/logs?view=weekly')

    expect(await screen.findByText('확정 1/5일')).toBeInTheDocument()
    expect(screen.queryByText(/확정 안 된 날/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주간' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '이전' }))
    expect(router.state.location.search).toContain('month=2026-09')
  })
})

describe('하루 마감 (SCR-LOG-03)', () => {
  const plan = (extra: Record<string, unknown> = {}) => ({
    date: '2026-10-07',
    log: period('2026-10-07', 'DRAFT'),
    nextWorkday: '2026-10-08',
    pendingCount: 0,
    planScope: 'NEXT_WORKDAY',
    carryOverCandidates: [
      {
        taskId: 't-1',
        title: '견적서 보내기',
        status: 'IN_PROGRESS',
        progress: 40,
        dueDate: '2026-10-09',
        projectId: null,
        selected: true,
      },
      {
        taskId: 't-2',
        title: '회의록 정리',
        status: 'TODO',
        progress: 0,
        dueDate: null,
        projectId: null,
        selected: true,
      },
    ],
    suggestions: [],
    ...extra,
  })
  const closeRoutes = (onClose = () => {}) => [
    { path: '/', element: <DayClose date="2026-10-07" today="2026-10-07" timeZone="Asia/Seoul" onClose={onClose} /> },
  ]

  it('2단계: 기본 모두 선택·안내 문구, 다음은 제목으로 포커스, 마감하면 넘길 일·이슈·version을 보내고 주간 제안을 보인다', async () => {
    const user = userEvent.setup()
    let sent: unknown = null
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, plan()),
      [LOG_URL]: () => json(200, workLog({ version: 4 })),
      'POST /api/worklog/logs/daily/2026-10-07/close': (init) => {
        sent = JSON.parse(String(init?.body))
        return json(200, {
          log: workLog({ status: 'CONFIRMED', version: 5, confirmedAt: '2026-10-07T09:00:00Z' }),
          suggestions: [
            {
              type: 'WEEKLY',
              periodStart: '2026-10-05',
              periodEnd: '2026-10-11',
              logStatus: 'NOT_WRITTEN',
              unconfirmedDates: ['2026-10-05'],
            },
          ],
        })
      },
    })
    renderApp('/', closeRoutes())

    expect(await screen.findByRole('heading', { name: '하루 마감 1/2' })).toBeInTheDocument()
    expect(
      screen.getByText('넘긴 일은 다음 근무일 계획에 들어가요. 업무의 마감일은 바뀌지 않아요.'),
    ).toBeInTheDocument()
    const first = screen.getByRole('checkbox', { name: /견적서 보내기/ })
    await waitFor(() => expect(first).toHaveFocus())
    expect(first).toBeChecked()
    await user.keyboard(' ')
    expect(first).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '하루 마감 2/2' })).toHaveFocus())
    await user.type(screen.getByRole('textbox', { name: /이슈 및 특이사항/ }), '거래처 회신 지연')
    expect(screen.getByText(/다음 근무일 계획 1건/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '마감하고 확정' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '오늘 일지를 확정했어요' })).toHaveFocus())
    expect(sent).toEqual({ carryOverTaskIds: ['t-2'], issue: '거래처 회신 지연', version: 4 })
    expect(screen.getByText('확정 안 된 날: 10/5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주간 일지 열기' })).toHaveAttribute('href', '/logs/weekly/2026-10-05')
  })

  it('확인 대기가 있으면 3단계, [이전]으로 돌아오면 제목에 포커스', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs/daily/2026-10-07/close': () =>
        json(200, plan({ pendingCount: 2, planScope: 'NEXT_WEEK' })),
      [LOG_URL]: () => json(200, workLog()),
    })
    renderApp('/', closeRoutes())

    expect(await screen.findByRole('heading', { name: '하루 마감 1/3' })).toBeInTheDocument()
    expect(screen.getByText(/확인 대기 기록이 2건 있어요/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '그대로 다음' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '하루 마감 2/3' })).toHaveFocus())
    expect(screen.getByText('넘긴 일은 다음 주 계획에 들어가요. 업무의 마감일은 바뀌지 않아요.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '이전' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '하루 마감 1/3' })).toHaveFocus())
  })

  it('계획 50줄 상한: 남은 칸만큼만 기본 선택·더 고를 수 없고 안내, 서버 400은 이유를 알린다', async () => {
    const user = userEvent.setup()
    const plans = Array.from({ length: 49 }, (_, i) => ({
      id: `p-${i}`,
      taskId: null,
      text: `계획 ${i}`,
      dueDate: null,
      scheduledAt: null,
    }))
    let reply = () => problemJson('carryOverTaskIds', 'TOO_MANY')
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, plan()),
      [LOG_URL]: () => json(200, workLog({}, { plans, issues: 'ㄱ'.repeat(1700) })),
      'POST /api/worklog/logs/daily/2026-10-07/close': () => reply(),
    })
    renderApp('/', closeRoutes())

    const first = await screen.findByRole('checkbox', { name: /견적서 보내기/ })
    const second = screen.getByRole('checkbox', { name: /회의록 정리/ })
    expect(first).toBeChecked()
    expect(second).not.toBeChecked()
    expect(second).toBeDisabled()
    expect(screen.getByRole('group', { name: '계획으로 넘길 업무' })).toHaveAccessibleDescription(
      '계획은 50줄까지라 1개까지 고를 수 있어요. (1/1)',
    )
    await user.click(first)
    expect(second).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '다음' }))
    // 기존 이슈 1700자 + 줄바꿈 → 299자까지
    const issue = await screen.findByRole('textbox', { name: /이슈 및 특이사항/ })
    expect(issue).toHaveAttribute('maxLength', '299')
    expect(issue).toHaveAccessibleDescription('일지의 이슈 칸이 2000자까지라 299자까지 남길 수 있어요.')

    await user.click(screen.getByRole('button', { name: '마감하고 확정' }))
    expect(await screen.findByText('계획은 50줄까지예요. 넘길 업무를 줄여 주세요')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: '하루 마감 1/2' })).toHaveFocus())

    reply = () => problemJson('issue', 'TOO_LONG')
    await user.click(screen.getByRole('button', { name: '다음' }))
    await user.click(await screen.findByRole('button', { name: '마감하고 확정' }))
    expect(await screen.findByText('이슈 및 특이사항은 모두 2000자까지예요. 이슈를 줄여 주세요')).toBeInTheDocument()
  })

  it('확인 대기 패널을 닫고 돌아오면 [확인 대기 처리] 버튼으로 포커스가 돌아온다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, plan({ pendingCount: 1 })),
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/records/pending': () =>
        json(200, {
          items: [
            {
              id: 'p-1',
              status: 'PENDING',
              workDate: '2026-10-07',
              content: '주간 회의',
              taskId: null,
              projectId: null,
              tagIds: [],
              scheduleId: 's-1',
              occurrenceStart: '2026-10-07T00:00:00Z',
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
                title: '주간 회의',
                allDay: false,
                startAt: '2026-10-07T00:00:00Z',
                endAt: '2026-10-07T01:00:00Z',
                startDate: null,
                endDate: null,
              },
            },
          ],
        }),
    })
    renderApp('/', closeRoutes())

    await user.click(await screen.findByRole('button', { name: '확인 대기 처리' }))
    expect(await screen.findByText('주간 회의')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: '확인 대기 처리' })).toHaveFocus())
  })

  it('이미 확정한 날은 해제 후 다시 마감하라고 알린다, Esc로 닫는다', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs/daily/2026-10-07/close': () => json(200, plan({ log: period('2026-10-07', 'CONFIRMED') })),
      [LOG_URL]: () => json(200, workLog({ status: 'CONFIRMED' })),
    })
    renderApp('/', closeRoutes(onClose))

    expect(await screen.findByText(/확정 해제 후 다시 마감할 수 있어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '일지 보기' })).toHaveAttribute('href', '/logs/daily/2026-10-07')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('홈 일지 카드 (SCR-HOME-01 ⑤⑦)', () => {
  const cardRoutes = [
    {
      path: '/',
      element: (
        <>
          <TodayLogCard today="2026-10-07" timeZone="Asia/Seoul" />
          <WeekLogStatus today="2026-10-07" weekFirst="2026-10-05" />
        </>
      ),
    },
  ]
  const week = () =>
    json(200, {
      items: [
        period('2026-10-05', 'CONFIRMED'),
        period('2026-10-06', 'DRAFT'),
        period('2026-10-07', 'NOT_WRITTEN'),
        period('2026-10-08', 'NO_RECORDS'),
        period('2026-10-09', 'NO_RECORDS', { workday: false, holiday: '한글날' }),
        period('2026-10-10', 'NO_RECORDS', { workday: false }),
        period('2026-10-11', 'NO_RECORDS', { workday: false }),
      ],
      unconfirmedDays: 2,
    })

  it('⑤ 불러오기 전에는 0건을 보이지 않고, 채움·[하루 마감]을 연 뒤 Esc로 닫으면 버튼으로 돌아온다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/logs': week,
      'GET /api/worklog/logs/daily/2026-10-07/close': () =>
        json(200, {
          date: '2026-10-07',
          log: period('2026-10-07', 'DRAFT'),
          nextWorkday: '2026-10-08',
          pendingCount: 0,
          planScope: 'NEXT_WORKDAY',
          carryOverCandidates: [],
          suggestions: [],
        }),
    })
    renderApp('/', cardRoutes)
    expect(screen.queryByText(/실적 0건/)).not.toBeInTheDocument()

    expect(await screen.findByText('실적 1건 · 계획 0건 · 이슈 없음')).toBeInTheDocument()
    expect(screen.getByText('1/3칸 채웠어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '일지 보기' })).toHaveAttribute('href', '/logs/daily/2026-10-07')

    const open = screen.getByRole('button', { name: '하루 마감' })
    await user.click(open)
    expect(await screen.findByRole('heading', { name: '하루 마감 1/2' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(open).toHaveFocus())
  })

  it('⑤ 확정한 날은 확정됨·확정 시각, [하루 마감] 없음. ⑦ 날마다 상태·휴일', async () => {
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog({ status: 'CONFIRMED', confirmedAt: '2026-10-07T09:04:00Z' })),
      'GET /api/worklog/logs': week,
    })
    renderApp('/', cardRoutes)

    expect(await screen.findByText('확정됨')).toBeInTheDocument()
    expect(screen.getByText('확정 2026-10-07 18:04')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '하루 마감' })).not.toBeInTheDocument()

    expect(await screen.findByRole('link', { name: '10월 5일 월요일 확정' })).toHaveAttribute(
      'href',
      '/logs/daily/2026-10-05',
    )
    expect(screen.getByRole('link', { name: '10월 6일 화요일 작성 중' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '10월 7일 수요일 미작성' })).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('link', { name: '10월 8일 목요일 예정' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '10월 9일 금요일 한글날' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '10월 10일 토요일 휴일' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주간 일지' })).toHaveAttribute('href', '/logs/weekly/2026-10-05')
  })
})

describe('일지 자동 저장 — 빈 줄', () => {
  it('실적 줄만 추가하면 보내지 않고(고정 안 됨), 글자를 쓰면 그때 저장한다', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': (init) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        return json(200, workLog({ version: 1 }, { achievementsAuto: false, achievements: body.achievements }))
      },
    })
    renderApp('/logs/daily/2026-10-07')

    await user.click(await screen.findByRole('button', { name: '＋ 실적 줄 추가' }))
    const input = await screen.findByRole('textbox', { name: '2번 업무 내용' })
    await waitFor(() => expect(input).toHaveFocus())
    await new Promise((r) => setTimeout(r, 1000))
    expect(bodies).toHaveLength(0)
    expect(screen.getByText('실적 자동')).toBeInTheDocument()

    await user.type(input, '거래처 미팅')
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 3000 })
    expect(bodies[0]).toMatchObject({ achievements: [{ id: 'a-1' }, { text: '거래처 미팅' }] })
  })
})

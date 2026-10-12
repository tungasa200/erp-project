// SCR-LOG-03 하루 마감 v1.1 (디자인 규칙 X-05, D-212 Q2·Q3·Q5): 대기 이름·[모두 했어요]·Ctrl+Enter 확정·완료 창 [확정 해제]·빠른 마감
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayClose } from '../logs/DayClose'
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

// 프로필이 다 차 있어 완료 창에 프로필 안내 줄은 없다. 그 줄은 profilePrompt.test.tsx
const me = () => json(200, { ...ME, name: '김하늘', organization: '개발팀', position: '매니저' })
const LOG_URL = 'GET /api/worklog/logs/daily/2026-10-07'
const CLOSE_URL = '/api/worklog/logs/daily/2026-10-07/close'

const period = (status: string) => ({
  type: 'DAILY',
  periodStart: '2026-10-07',
  periodEnd: '2026-10-07',
  status,
  logId: 'log-1',
  workday: true,
  holiday: null,
})

const workLog = (extra: Record<string, unknown> = {}) => ({
  id: 'log-1',
  type: 'DAILY',
  periodStart: '2026-10-07',
  periodEnd: '2026-10-07',
  status: 'DRAFT',
  version: 1,
  confirmedAt: null,
  sourceChangedAfterConfirm: false,
  planCandidates: [],
  content: {
    title: '업무일지',
    planTitle: '다음 근무일 계획',
    planPeriod: { start: '2026-10-08', end: '2026-10-08' },
    author: { name: '김하늘', organization: '개발팀', position: '매니저' },
    achievementsAuto: true,
    achievements: [
      { id: 'a-1', text: '주간 회의', result: '완료', progress: null, projectId: null, sourceRecordIds: [] },
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
    days: [],
    projects: [],
    time: null,
  },
  ...extra,
})

const plan = (extra: Record<string, unknown> = {}) => ({
  date: '2026-10-07',
  log: period('DRAFT'),
  nextWorkday: '2026-10-08',
  pendingCount: 0,
  planScope: 'NEXT_WORKDAY',
  carryOverCandidates: [
    {
      taskId: 't-1',
      title: '견적서 보내기',
      status: 'TODO',
      progress: 0,
      dueDate: null,
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

const pendingRec = (id: string, title: string, startAt: string, endAt: string, version = 0) => ({
  id,
  status: 'PENDING',
  workDate: startAt.slice(0, 10),
  content: title,
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: `s-${id}`,
  occurrenceStart: startAt,
  result: null,
  outcome: null,
  progress: null,
  startAt: null,
  endAt: null,
  durationMin: null,
  deletedAt: null,
  createdAt: startAt,
  updatedAt: startAt,
  version,
  plan: { title, allDay: false, startAt, endAt, startDate: null, endDate: null },
})

const closeRoutes = (onClose = () => {}, quick = false) => [
  {
    path: '/',
    element: <DayClose date="2026-10-07" today="2026-10-07" timeZone="Asia/Seoul" quick={quick} onClose={onClose} />,
  },
]

describe('하루 마감 v1.1 (SCR-LOG-03, X-05)', () => {
  it('UX-LOG-44·45 1단계는 대기 이름·다른 날 배지를 보이고, Enter로 [모두 했어요]·5초 되돌리기, 3단계는 요약 한 줄만', async () => {
    const user = userEvent.setup()
    const review = ['p-2', '견적서 검토', '2026-10-07T06:00:00Z', '2026-10-07T07:30:00Z'] as const
    const tidy = ['p-1', '문서 정리', '2026-10-05T01:00:00Z', '2026-10-05T02:00:00Z'] as const
    const confirmBodies: unknown[] = []
    const patches: unknown[] = []
    const patch = (rec: typeof review | typeof tidy) => (init?: RequestInit) => {
      patches.push(JSON.parse(String(init?.body)))
      return json(200, pendingRec(rec[0], rec[1], rec[2], rec[3], 2))
    }
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan({ pendingCount: 2 })),
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/records/pending': () => json(200, { items: [pendingRec(...review), pendingRec(...tidy)] }),
      'POST /api/worklog/records/pending/confirm': (init) => {
        confirmBodies.push(JSON.parse(String(init?.body)))
        return json(200, {
          items: [
            { ...pendingRec(...tidy, 1), status: 'CONFIRMED' },
            { ...pendingRec(...review, 1), status: 'CONFIRMED' },
          ],
        })
      },
      'PATCH /api/worklog/records/p-1': patch(tidy),
      'PATCH /api/worklog/records/p-2': patch(review),
    })
    renderApp('/', closeRoutes())

    const list = await screen.findByRole('list', { name: '확인 대기 기록' })
    const items = within(list).getAllByRole('listitem')
    // 계획 시각 순, 다른 날은 날짜 배지
    expect(items[0]).toHaveTextContent(/10:00 – 11:00\s*문서 정리\s*10\/5/)
    expect(items[1]).toHaveTextContent(/15:00 – 16:30\s*견적서 검토$/)
    const all = screen.getByRole('button', { name: '모두 했어요' })
    await waitFor(() => expect(all).toHaveFocus())
    expect(screen.getByRole('button', { name: '하나씩 확인' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '그대로 다음' })).toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(await screen.findByText('확인 대기 2건을 ‘했어요’로 기록했어요')).toBeInTheDocument()
    expect(confirmBodies).toEqual([{ ids: ['p-1', 'p-2'] }])
    await waitFor(() => expect(screen.getByRole('heading', { name: '하루 마감 2/3' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: '다음' }))
    // 일지 미리보기(다른 날 기록 안내 포함)는 업무일지 숨김으로 없고 요약 한 줄만 남는다
    expect(await screen.findByText(/^확정 기록 \d+건 · /)).toBeInTheDocument()
    expect(screen.queryByText(/다른 날 기록/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches).toEqual([
      { status: 'PENDING', version: 1 },
      { status: 'PENDING', version: 1 },
    ])
  })

  it('UX-LOG-152 확정하면 [모두 했어요] 되돌리기 토스트를 닫는다 — 확정 일지 실적과 확인 대기가 어긋나지 않게', async () => {
    const user = userEvent.setup()
    const rec = ['p-1', '문서 정리', '2026-10-07T01:00:00Z', '2026-10-07T02:00:00Z'] as const
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan({ pendingCount: 1, carryOverCandidates: [] })),
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/records/pending': () => json(200, { items: [pendingRec(...rec)] }),
      'POST /api/worklog/records/pending/confirm': () =>
        json(200, { items: [{ ...pendingRec(...rec, 1), status: 'CONFIRMED' }] }),
      [`POST ${CLOSE_URL}`]: () => json(200, { log: workLog({ status: 'CONFIRMED', version: 2 }), suggestions: [] }),
    })
    renderApp('/', closeRoutes())
    await user.click(await screen.findByRole('button', { name: '모두 했어요' }))
    expect(await screen.findByRole('button', { name: '되돌리기' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다음' }))
    await user.click(await screen.findByRole('button', { name: '오늘 마감' }))
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()
  })

  it('UX-LOG-44 확정은 Ctrl+Enter다: 이슈 칸의 Enter로는 확정하지 않는다', async () => {
    const user = userEvent.setup()
    const close = vi.fn(() => json(200, { log: workLog({ status: 'CONFIRMED', version: 2 }), suggestions: [] }))
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan({ carryOverCandidates: [] })),
      [LOG_URL]: () => json(200, workLog()),
      [`POST ${CLOSE_URL}`]: close,
    })
    renderApp('/', closeRoutes())
    await user.click(await screen.findByRole('button', { name: '다음' }))
    const issue = await screen.findByRole('textbox', { name: /이슈 및 특이사항/ })
    expect(screen.getByRole('button', { name: '오늘 마감' })).toHaveAccessibleDescription(/Enter로 마감$/)
    await user.type(issue, '회신 지연{Enter}')
    expect(close).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('UX-LOG-144 넘길 일 단계는 체크박스 위 Enter로 넘어가고, 이슈 단계는 칸으로 포커스, 쓴 글은 Esc로 말없이 버리지 않는다', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan()),
      [LOG_URL]: () => json(200, workLog()),
    })
    renderApp('/', closeRoutes(onClose))
    const first = await screen.findByRole('checkbox', { name: /견적서 보내기/ })
    first.focus()
    await user.keyboard('{Enter}')
    const issue = await screen.findByRole('textbox', { name: /이슈 및 특이사항/ })
    await waitFor(() => expect(issue).toHaveFocus())
    await user.type(issue, '회신 지연')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(issue).toHaveValue('회신 지연')
  })

  it('UX-LOG-46 완료 창: 요약 한 줄, 상시 [마감 취소]는 창 안에서 묻고(포커스 [계속 두기], Esc는 계속 두기), 취소하면 [다시 마감]', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const unconfirm = vi.fn(() => json(200, workLog({ status: 'DRAFT', version: 3 })))
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan({ carryOverCandidates: [] })),
      [LOG_URL]: () => json(200, workLog()),
      [`POST ${CLOSE_URL}`]: () => json(200, { log: workLog({ status: 'CONFIRMED', version: 2 }), suggestions: [] }),
      'POST /api/worklog/logs/log-1/unconfirm': unconfirm,
    })
    renderApp('/', closeRoutes(onClose))
    await user.click(await screen.findByRole('button', { name: '다음' }))
    await user.click(await screen.findByRole('button', { name: '오늘 마감' }))
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(screen.getByText('확정 기록 1건 · 내일 계획 0건')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '마감 취소' }))
    const ask = screen.getByRole('group', { name: /마감을 취소할까요/ })
    await waitFor(() => expect(within(ask).getByRole('button', { name: '계속 두기' })).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: /마감을 취소할까요/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '마감 취소' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: '마감 취소' }))
    const again = screen.getByRole('group', { name: /마감을 취소할까요/ })
    await user.click(within(again).getByRole('button', { name: '마감 취소' }))
    expect(await screen.findByRole('heading', { name: '마감을 취소했어요' })).toBeInTheDocument()
    expect(unconfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '다시 마감' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '일지 보기' })).not.toBeInTheDocument()
  })

  it('팔레트 빠른 마감: 단계 없이 넘길 일은 기본 선택·이슈 없이 바로 확정하고 완료 창을 보인다', async () => {
    let sent: unknown = null
    stubFetch({
      'GET /api/users/me': me,
      [`GET ${CLOSE_URL}`]: () => json(200, plan({ pendingCount: 3 })),
      [LOG_URL]: () => json(200, workLog({ version: 4 })),
      [`POST ${CLOSE_URL}`]: (init) => {
        sent = JSON.parse(String(init?.body))
        return json(200, { log: workLog({ status: 'CONFIRMED', version: 5 }), suggestions: [] })
      },
    })
    renderApp(
      '/',
      closeRoutes(() => {}, true),
    )
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(sent).toEqual({ carryOverTaskIds: ['t-1', 't-2'], issue: null, version: 4 })
    expect(screen.getByRole('button', { name: '마감 취소' })).toBeInTheDocument()
  })
})

// SCR-ONB-01 프로필 입력 요청 (P3): 저절로 뜨지 않고 일지 문서 위 한 줄의 [입력]으로 연다(재평가 §4 #26). 하루 마감은 완료 창의 한 줄(UX-LOG-56, D-212 Q5)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayClose } from '../logs/DayClose'
import { json, ME, renderApp, routesWithHidden, stubFetch } from './renderApp'

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

const PARTIAL = { ...ME, name: '김하늘' }

const draft = (date: string, version = 1) => ({
  id: `log-${date}`,
  type: 'DAILY',
  periodStart: date,
  periodEnd: date,
  status: 'DRAFT',
  version,
  confirmedAt: null,
  sourceChangedAfterConfirm: false,
  planCandidates: [],
  content: {
    title: '업무일지',
    planTitle: '다음 근무일 계획',
    planPeriod: { start: date, end: date },
    author: { name: '김하늘', organization: null, position: null },
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

const PROMPT = '작성자 정보를 넣을까요?'

describe('일지 화면의 프로필 한 줄 (SCR-ONB-01, 재평가 §4 #26)', () => {
  it('창은 저절로 뜨지 않고, [입력]으로 열면 이름 칸에 포커스, 저장하면 한 줄이 사라지고 제목으로 돌아온다', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | null = null
    let me: Record<string, unknown> = PARTIAL
    const refresh = vi.fn(() => json(200, {}))
    stubFetch({
      'GET /api/users/me': () => json(200, me),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft('2026-10-07')),
      'PATCH /api/users/me': (init) => {
        patched = JSON.parse(String(init?.body))
        me = { ...PARTIAL, ...patched, version: 1 }
        return json(200, me)
      },
      'POST /api/worklog/me/profile/refresh': refresh,
    })
    renderApp('/logs/daily/2026-10-07', routesWithHidden)

    await screen.findByRole('heading', { name: '금일 실적' })
    expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument()
    expect(screen.getByText('이름·소속을 넣으면 문서에 들어가요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '입력' }))

    const dialog = await screen.findByRole('dialog', { name: PROMPT })
    const name = within(dialog).getByRole('textbox', { name: '이름' })
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveValue('김하늘')
    const preview = dialog.querySelector('dl')!
    expect(preview).toHaveTextContent('[소속]')

    await user.type(within(dialog).getByRole('textbox', { name: '소속' }), '개발팀')
    await user.type(within(dialog).getByRole('textbox', { name: '직책' }), '매니저')
    expect(preview).toHaveTextContent('개발팀')
    expect(preview).toHaveTextContent('2026년 10월 7일 (수)')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument())
    expect(patched).toEqual({ name: '김하늘', organization: '개발팀', position: '매니저', version: 0 })
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    expect(screen.queryByText('이름·소속을 넣으면 문서에 들어가요')).not.toBeInTheDocument()
  })

  it('[나중에]는 창만 닫고 [입력]으로 돌아온다. 한 줄은 남는다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, PARTIAL),
      'GET /api/worklog/logs/daily/2026-10-06': () => json(200, draft('2026-10-06')),
    })
    renderApp('/logs/daily/2026-10-06', routesWithHidden)

    const open = await screen.findByRole('button', { name: '입력' })
    await user.click(open)
    const dialog = await screen.findByRole('dialog', { name: PROMPT })
    // 미리보기 일자는 오늘(10/7)이 아니라 열린 일지의 날짜
    expect(dialog).toHaveTextContent('2026년 10월 6일 (화)')
    await user.click(within(dialog).getByRole('button', { name: '나중에' }))
    expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument()
    await waitFor(() => expect(open).toHaveFocus())
    expect(screen.getByText('이름·소속을 넣으면 문서에 들어가요')).toBeInTheDocument()
  })

  it('저장에 실패하면 창을 닫지 않고 이유를 알린다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, PARTIAL),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft('2026-10-07')),
      'PATCH /api/users/me': () => json(500, { status: 500, code: 'INTERNAL', title: 'x', traceId: 't-1' }),
    })
    renderApp('/logs/daily/2026-10-07', routesWithHidden)

    await user.click(await screen.findByRole('button', { name: '입력' }))
    const dialog = await screen.findByRole('dialog', { name: PROMPT })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('저장하지 못했어요')
    expect(dialog).toBeInTheDocument()
  })
})

describe('하루 마감 완료 창의 프로필 안내 (UX-LOG-56)', () => {
  it('확정은 막지 않고, 완료 창에 프로필 안내를 두지 않는다(업무일지 숨김, 문안 표 3-8)', async () => {
    const user = userEvent.setup()
    const close = vi.fn(() =>
      json(200, { log: { ...draft('2026-10-07'), status: 'CONFIRMED' }, suggestions: [], unconfirmedDates: [] }),
    )
    stubFetch({
      'GET /api/users/me': () => json(200, PARTIAL),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft('2026-10-07')),
      'GET /api/worklog/logs/daily/2026-10-07/close': () =>
        json(200, {
          date: '2026-10-07',
          log: {
            type: 'DAILY',
            periodStart: '2026-10-07',
            periodEnd: '2026-10-07',
            status: 'DRAFT',
            logId: 'log-2026-10-07',
            workday: true,
            holiday: null,
          },
          nextWorkday: '2026-10-08',
          pendingCount: 0,
          planScope: 'NEXT_WORKDAY',
          carryOverCandidates: [],
          suggestions: [],
        }),
      'POST /api/worklog/logs/daily/2026-10-07/close': close,
    })
    renderApp('/', [
      {
        path: '/',
        element: <DayClose date="2026-10-07" today="2026-10-07" timeZone="Asia/Seoul" onClose={() => {}} />,
      },
    ])

    await screen.findByRole('heading', { name: '하루 마감 1/2' })
    await user.click(screen.getByRole('button', { name: '다음' }))
    await user.click(await screen.findByRole('button', { name: '오늘 마감' }))
    expect(await screen.findByRole('heading', { name: '오늘 하루를 마감했어요' })).toBeInTheDocument()
    expect(close).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument()
    expect(screen.queryByText('이름·소속을 넣으면 문서에 들어가요')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '입력' })).not.toBeInTheDocument()
  })
})

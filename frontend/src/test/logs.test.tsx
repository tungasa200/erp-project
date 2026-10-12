// 업무일지 화면 (SCR-LOG-01·02, P3-06·08): 자동/고정 알약, 첫 실적 수정 → 고정 알림, 다시 채우기·확정·해제 대화상자, 목록 미작성 → 초안
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogPeriod, WorkLog } from '../logs/api'
import { DayClose } from '../logs/DayClose'
import { DayCloseHost } from '../logs/DayCloseHost'
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
    // 말풍선은 Esc로 닫히고(LOG-102), 포커스가 떠나면 다시 뜰 수 있다
    pill.focus()
    await user.keyboard('{Escape}')
    expect(pill).toHaveAttribute('data-tip-hidden')
    await user.tab()
    expect(pill).not.toHaveAttribute('data-tip-hidden')
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

  it('다른 곳에서 먼저 고쳤으면(409) 충돌 띠(화면정의서 2.5)와 내 수정 내용 복사·새로 불러오기', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': () => problem(409, 'VERSION_CONFLICT'),
    })
    renderApp('/logs/daily/2026-10-07')

    const result = await screen.findByRole('textbox', { name: '1번 결과' })
    await user.type(result, '추가')
    const banner = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(banner).toHaveTextContent('다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요')
    expect(within(banner).getByRole('button', { name: '내 수정 내용 복사' })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: '새로 불러오기' })).toBeInTheDocument()
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
      '확정본 내용이 그대로 초안이 되고, 원본 기록을 다시 반영하려면 ‘원본에서 다시 채우기’를 쓰세요.',
    )
    await user.click(within(dialog).getByRole('button', { name: '확정 해제' }))
    expect(
      await screen.findByText('확정을 해제했어요. 일지는 초안으로 돌아가고 내보낸 파일은 그대로예요'),
    ).toBeInTheDocument()
    expect(screen.getByText('실적 고정')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '1번 결과' })).toBeInTheDocument()
  })

  it('UX-LOG-41 문서 끝(이슈 칸 아래)에 확정 줄이 있고 이것이 화면의 채움이다. 위쪽 [확정]은 보조', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(() =>
      json(200, workLog({ status: 'CONFIRMED', version: 1, confirmedAt: '2026-10-07T09:00:00Z' })),
    )
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'POST /api/worklog/logs/log-1/confirm': confirm,
    })
    renderApp('/logs/daily/2026-10-07')
    const end = await screen.findByRole('button', { name: '일지 확정' })
    const issues = screen.getByRole('textbox', { name: /이슈 및 특이사항/ })
    // 이슈 칸 뒤에 온다
    expect(issues.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(end).toHaveClass('primary')
    expect(screen.getByRole('button', { name: '확정' })).toHaveClass('secondary')
    await user.click(end)
    expect(await screen.findByText('일지를 확정했어요')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '일지 확정' })).not.toBeInTheDocument()
  })

  it('UX-LOG-49 확정 뒤 원본이 바뀌면 보이는 띠와 [다시 확정하기]: 묻고 나서 해제·다시 채우기·확정을 한 번에 한다', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const confirmed = (version: number, changed: boolean) =>
      workLog({ status: 'CONFIRMED', version, confirmedAt: '2026-10-07T09:00:00Z', sourceChangedAfterConfirm: changed })
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, confirmed(3, true)),
      'POST /api/worklog/logs/log-1/unconfirm': (init) => {
        order.push(`unconfirm ${JSON.parse(String(init?.body)).version}`)
        return json(200, workLog({ version: 4 }, { achievementsAuto: false }))
      },
      'POST /api/worklog/logs/log-1/refill': (init) => {
        order.push(`refill ${JSON.parse(String(init?.body)).version}`)
        return json(200, workLog({ version: 5 }))
      },
      'POST /api/worklog/logs/log-1/confirm': (init) => {
        order.push(`confirm ${JSON.parse(String(init?.body)).version}`)
        return json(200, confirmed(6, false))
      },
    })
    renderApp('/logs/daily/2026-10-07')
    const band = await screen.findByRole('region', { name: '원본이 바뀜' })
    expect(band).toHaveTextContent('확정한 뒤 원본 기록이 바뀌었어요')
    await user.click(within(band).getByRole('button', { name: '다시 확정하기' }))
    const dialog = screen.getByRole('alertdialog', { name: '바뀐 기록으로 다시 확정할까요?' })
    expect(order).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: '다시 확정' }))
    expect(await screen.findByText('바뀐 기록으로 다시 확정했어요')).toBeInTheDocument()
    expect(order).toEqual(['unconfirm 3', 'refill 4', 'confirm 5'])
    expect(screen.queryByRole('region', { name: '원본이 바뀜' })).not.toBeInTheDocument()
  })

  it('변경 이력: Tab은 창 안을 돌고 배경은 inert, 확정본↔목록 전환 때 포커스가 창 안 짝으로 간다(P3-QA-LOG-04-K1)', async () => {
    const user = userEvent.setup()
    const confirmed = workLog({ status: 'CONFIRMED', version: 1, confirmedAt: '2026-10-07T09:00:00Z' })
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, confirmed),
      'GET /api/worklog/logs/log-1/revisions': () =>
        json(200, { items: [{ revisionNo: 1, confirmedAt: '2026-10-07T09:00:00Z', unconfirmedAt: null }] }),
      'GET /api/worklog/logs/log-1/revisions/1': () =>
        json(200, { revisionNo: 1, confirmedAt: '2026-10-07T09:00:00Z', content: confirmed.content }),
    })
    renderApp('/logs/daily/2026-10-07')

    const open = await screen.findByRole('button', { name: '변경 이력' })
    await user.click(open)
    const dialog = screen.getByRole('dialog', { name: '변경 이력' })
    expect(screen.getByRole('heading', { level: 1 }).closest('[inert]')).not.toBeNull()
    const row = await within(dialog).findByRole('button', { name: /1번째 확정/ })
    const close = within(dialog).getByRole('button', { name: '닫기' })
    expect(close).toHaveFocus()
    await user.tab()
    expect(row).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(row).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '1번째 확정본' })).toBeInTheDocument()
    const back = within(dialog).getByRole('button', { name: '← 이력 목록' })
    expect(back).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(dialog).getByRole('button', { name: /1번째 확정/ })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('[inert]')).toBeNull()
    await waitFor(() => expect(open).toHaveFocus())
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
    // 좁은 화면 점 범례(넓은 화면은 CSS로 숨김): 글자만 읽히고 점은 aria-hidden
    const legend = screen.getByText('미작성', { selector: 'li' }).parentElement!
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['확정', '초안', '미작성', '기록 없음'])
    expect(legend.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)

    const draft = screen.getByRole('button', { name: /10월 7일.*미작성 — 초안 만들기/ })
    draft.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/logs/daily/2026-10-07'))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('UX-LOG-51 확정 안 된 날 띠의 버튼으로 첫 미확정 날을 연다(미작성이면 초안을 만든 뒤)', async () => {
    const user = userEvent.setup()
    const create = vi.fn(() => json(201, workLog()))
    stubFetch({
      'GET /api/users/me': me,
      'GET /api/worklog/logs': () => json(200, { items: october(), unconfirmedDays: 1 }),
      'POST /api/worklog/logs/daily/2026-10-07': create,
      [LOG_URL]: () => json(200, workLog()),
    })
    const { router } = renderApp('/logs')

    const go = await screen.findByRole('button', { name: /부터 보기$/ })
    go.focus()
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
            period('2026-10-12', 'NO_RECORDS', {
              type: 'WEEKLY',
              periodEnd: '2026-10-18',
              days: { confirmed: 0, workdays: 5 },
            }),
          ],
          unconfirmedDays: 0,
        })
      },
    })
    const { router } = renderApp('/logs?view=weekly')

    expect(await screen.findByText('확정 1/5일')).toBeInTheDocument()
    // 앞으로 올 주는 상태 배지처럼 확정 일수도 숨긴다
    expect(screen.queryByText('확정 0/5일')).not.toBeInTheDocument()
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

  it('2단계: 기본 모두 선택·안내 문구, 다음은 이슈 칸으로 포커스, 마감하면 넘길 일·이슈·version을 보내고 주간 제안을 보인다', async () => {
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
    // 마지막 단계는 이슈 칸으로 바로 간다(UX-LOG-144)
    expect(await screen.findByRole('heading', { name: '하루 마감 2/2' })).toBeInTheDocument()
    const issue = screen.getByRole('textbox', { name: /이슈 및 특이사항/ })
    await waitFor(() => expect(issue).toHaveFocus())
    await user.type(issue, '거래처 회신 지연')
    expect(screen.getByText(/다음 근무일 계획 1건/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '마감하고 확정' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '오늘 일지를 확정했어요' })).toHaveFocus())
    expect(sent).toEqual({ carryOverTaskIds: ['t-2'], issue: '거래처 회신 지연', version: 4 })
    expect(screen.getByText('확정 안 된 날: 10/5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주간 일지 열기' })).toHaveAttribute('href', '/logs/weekly/2026-10-05')

    // 제목에 포커스가 있을 때 Shift+Tab도 창 안 마지막 자리로(body로 빠지지 않게)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    const dialog = screen.getByRole('dialog')
    const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'))
    const last = tabbable.find(
      (el) => !tabbable.some((o) => el.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING),
    )
    expect(last).toHaveFocus()
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

  it('확인 대기 패널을 닫고 돌아오면 [하나씩 확인] 버튼으로 포커스가 돌아온다', async () => {
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

    await user.click(await screen.findByRole('button', { name: '하나씩 확인' }))
    expect(await screen.findByRole('heading', { name: /확인 대기/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: '하나씩 확인' })).toHaveFocus())
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
          <DayCloseHost />
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

  it('UX-LOG-140 빈 줄이 남아 있어도 다른 줄의 삭제는 저장하고(빈 줄만 빼고 보냄), 확정할 때 빈 줄은 뺐다고 알린다', async () => {
    const user = userEvent.setup()
    const bodies: { achievements?: unknown[] }[] = []
    let server = workLog()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, server),
      'PATCH /api/worklog/logs/log-1': (init) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        server = workLog({ version: 1 }, { achievementsAuto: false, achievements: body.achievements })
        return json(200, server)
      },
      'POST /api/worklog/logs/log-1/confirm': () => json(200, { ...server, status: 'CONFIRMED', version: 2 }),
    })
    renderApp('/logs/daily/2026-10-07')

    await user.click(await screen.findByRole('button', { name: '＋ 실적 줄 추가' }))
    await screen.findByRole('textbox', { name: '2번 업무 내용' })
    await user.click(screen.getByRole('button', { name: '1번 줄 삭제' }))
    // 자동 저장(0.8초) 뒤 지운 줄이 빠진 목록이 간다. 빈 줄은 보내지 않는다
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 3000 })
    expect(bodies[0].achievements).toEqual([])
    // 빈 줄은 화면에 그대로 남는다
    expect(screen.getByRole('textbox', { name: '1번 업무 내용' })).toHaveValue('')

    await user.click(screen.getByRole('button', { name: '확정' }))
    expect(await screen.findByText('일지를 확정했어요. 빈 줄은 빼고 저장했어요')).toBeInTheDocument()
    expect(bodies).toHaveLength(1)
  })
})

describe('일지 오프라인 (UX-LOG-40)', () => {
  it('오프라인이면 칸은 읽기 전용·버튼은 꺼지고, 보내지 못한 수정은 표시했다가 다시 연결되면 보낸다', async () => {
    const user = userEvent.setup()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const bodies: { issues?: string }[] = []
    let down = false
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': (init) => {
        if (down) throw new TypeError('Failed to fetch')
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        return json(200, workLog({ version: 1 }, { issues: body.issues }))
      },
    })
    renderApp('/logs/daily/2026-10-07')

    const issues = await screen.findByRole('textbox', { name: '이슈 및 특이사항' })
    // 입력 직후(자동 저장 0.8초 전)에 연결이 끊긴다
    down = true
    await user.type(issues, '지하철에서 씀')
    online.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))

    await waitFor(() => expect(screen.getByText('저장 안 된 변경 · 연결되면 저장해요')).toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(issues).toHaveAttribute('readonly')
    expect(issues).toHaveValue('지하철에서 씀')
    expect(screen.getByRole('textbox', { name: '1번 결과' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '＋ 실적 줄 추가' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1번 줄 삭제' })).toBeDisabled()
    await user.type(issues, '더')
    expect(issues).toHaveValue('지하철에서 씀')

    down = false
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ issues: '지하철에서 씀' })
    expect(await screen.findByText('저장됨')).toBeInTheDocument()
    expect(issues).not.toHaveAttribute('readonly')
  })

  it('보내지 못한 수정이 남은 채 다른 화면으로 가면 먼저 묻고, 꺼지는 줄 버튼의 포커스는 그 줄 칸으로 옮긴다', async () => {
    const user = userEvent.setup()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderApp('/logs/daily/2026-10-07')

    const result = await screen.findByRole('textbox', { name: '1번 결과' })
    await user.type(result, ' 추가')
    const remove = screen.getByRole('button', { name: '1번 줄 삭제' })
    remove.focus()
    online.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(remove).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '1번 업무 내용' })).toHaveFocus()

    await user.click(
      within(screen.getByRole('navigation', { name: '일지 이동' })).getByRole('link', { name: '업무일지' }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: '저장 안 된 변경이 있어요' })
    expect(dialog).toHaveTextContent('지금 나가면 이 수정은 사라져요')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(result).toHaveValue('초안 완료 추가')

    await user.click(
      within(screen.getByRole('navigation', { name: '일지 이동' })).getByRole('link', { name: '업무일지' }),
    )
    await user.click(
      within(await screen.findByRole('alertdialog', { name: '저장 안 된 변경이 있어요' })).getByRole('button', {
        name: '나가기',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '1번 결과' })).not.toBeInTheDocument())
  })
})

describe('일지 줄 삭제 되돌리기 (UX-LOG-101)', () => {
  it('UX-LOG-141 마지막 실적 줄을 지우면 포커스가 제목이 아니라 [＋ 실적 줄 추가]로 간다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': () => json(200, workLog()),
    })
    renderApp('/logs/daily/2026-10-07')
    await user.click(await screen.findByRole('button', { name: '1번 줄 삭제' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '＋ 실적 줄 추가' })).toHaveFocus())
  })

  it('UX-LOG-43 표가 넘치면 오른쪽 그림자와 처음 한 번 "옆으로 밀어 보기"를 보이고, 한 번 밀면 이 기기에서는 숨긴다', async () => {
    localStorage.removeItem('wy.log.swipeHintSeen')
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
    stubFetch({ 'GET /api/users/me': me, [LOG_URL]: () => json(200, workLog()) })
    renderApp('/logs/daily/2026-10-07')
    const region = await screen.findByRole('region', { name: '실적 표 (가로로 밀어 보기)' })
    expect(region.parentElement).toHaveAttribute('data-more')
    expect(screen.getByText('옆으로 밀어 보기 →')).toBeInTheDocument()
    region.scrollLeft = 280
    fireEvent.scroll(region)
    expect(screen.queryByText('옆으로 밀어 보기 →')).not.toBeInTheDocument()
    expect(region.parentElement).not.toHaveAttribute('data-more')
    expect(localStorage.getItem('wy.log.swipeHintSeen')).toBe('1')
    localStorage.removeItem('wy.log.swipeHintSeen')
  })

  it('×로 지운 실적 줄은 5초 되돌리기 토스트로 같은 자리에 돌아오고, 포커스도 그 줄로 간다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': () => json(200, workLog()),
    })
    renderApp('/logs/daily/2026-10-07')
    const first = await screen.findByRole('textbox', { name: '1번 업무 내용' })
    const text = (first as HTMLTextAreaElement).value
    await user.click(screen.getByRole('button', { name: '1번 줄 삭제' }))
    expect(screen.queryByDisplayValue(text)).not.toBeInTheDocument()
    expect(await screen.findByText('실적 줄을 지웠어요')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    const back = await screen.findByRole('textbox', { name: '1번 업무 내용' })
    expect(back).toHaveValue(text)
    await waitFor(() => expect(back).toHaveFocus())
  })

  it('줄을 지우고 바로 다른 일지로 옮기면 되돌리기 토스트를 닫는다 — 내려간 편집기로 조용히 실패하지 않게(UX-LOG-142)', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'GET /api/worklog/logs/daily/2026-10-06': () =>
        json(200, workLog({ id: 'log-0', periodStart: '2026-10-06', periodEnd: '2026-10-06' })),
      'PATCH /api/worklog/logs/log-1': () => json(200, workLog()),
    })
    const { router } = renderApp('/logs/daily/2026-10-07')
    await screen.findByRole('textbox', { name: '1번 업무 내용' })
    await user.click(screen.getByRole('button', { name: '1번 줄 삭제' }))
    expect(await screen.findByText('실적 줄을 지웠어요')).toBeInTheDocument()
    await act(() => router.navigate('/logs/daily/2026-10-06'))
    await waitFor(() => expect(screen.queryByText('실적 줄을 지웠어요')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()
  })

  it('결과만 쓰고 업무 내용을 비운 줄은 칸에 무엇이 빠졌는지 보이고, 앱 안에서 떠날 때 묻는다(UX-LOG-143)', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': me,
      [LOG_URL]: () => json(200, workLog()),
      'PATCH /api/worklog/logs/log-1': () => json(200, workLog()),
    })
    renderApp('/logs/daily/2026-10-07')
    await user.click(await screen.findByRole('button', { name: '＋ 실적 줄 추가' }))
    await user.type(await screen.findByRole('textbox', { name: '2번 결과' }), '고객 확인 끝남')
    const text = screen.getByRole('textbox', { name: '2번 업무 내용' })
    expect(text).toHaveAttribute('placeholder', '업무 내용을 적어 주세요')
    expect(text).toHaveAttribute('aria-invalid', 'true')

    await user.click(
      within(screen.getByRole('navigation', { name: '일지 이동' })).getByRole('link', { name: '업무일지' }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: '저장 안 된 변경이 있어요' })
    expect(dialog).toHaveTextContent('결과만 쓴 줄은 저장되지 않아요')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.getByRole('textbox', { name: '2번 결과' })).toHaveValue('고객 확인 끝남')
  })
})

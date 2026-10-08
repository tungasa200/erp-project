// SCR-LOG-05 내보내기 · SCR-LOG-06 내보내기 전 이메일 인증 (P3-10, EXP-01~04, AUTH-08, D-41·D-109)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileNameOf } from '../api/client'
import type { LogAchievement } from '../logs/api'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

// 서울 2026-10-07(수) 12:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
  saved = []
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

let saved: string[] = []
const VERIFIED = { ...ME, emailVerified: true, name: '김하늘', organization: '개발팀', position: '매니저' }
const later = (s: number) => new Date(Date.now() + s * 1000).toISOString()

const draft = (status: 'DRAFT' | 'CONFIRMED' = 'DRAFT') => ({
  id: 'log-1',
  type: 'DAILY',
  periodStart: '2026-10-07',
  periodEnd: '2026-10-07',
  status,
  version: 1,
  confirmedAt: status === 'CONFIRMED' ? '2026-10-07T09:00:00Z' : null,
  sourceChangedAfterConfirm: false,
  planCandidates: [],
  content: {
    title: '업무일지',
    planTitle: '다음 근무일 계획',
    planPeriod: { start: '2026-10-08', end: '2026-10-08' },
    author: { name: '김하늘', organization: '개발팀', position: '매니저' },
    achievementsAuto: true,
    achievements: [
      {
        id: 'a-1',
        source: 'RECORD',
        text: '결제 API 설계',
        result: '엔드포인트 6개 확정',
        outcome: 'IN_PROGRESS',
        progress: 70,
        taskId: 't-1',
        projectName: '개발',
        recordIds: ['r-1'],
        dates: ['2026-10-07'],
        durationMin: null,
      },
    ] as LogAchievement[],
    plans: [
      { id: 'p-1', taskId: null, text: '스프린트 리뷰 발표', dueDate: null, scheduledAt: '2026-10-08T01:00:00Z' },
    ],
    issues: '한빛상사 견적 회신 지연',
    metrics: {
      recordCount: 1,
      done: 0,
      reviewRequested: 0,
      inProgress: 1,
      completedTaskCount: 0,
      pendingCount: 0,
      totalMin: null,
    },
    days: [],
    projects: [],
    time: null,
  },
})

const file = (name: string) => () =>
  new Response(new Blob(['x']), {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="worklog.x"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  })

async function openExport(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: '내보내기' })
  await user.click(button)
  return { button, dialog: await screen.findByRole('dialog', { name: '내보내기' }) }
}

describe('내보내기 (SCR-LOG-05)', () => {
  it('일지 화면: PDF가 골라져 포커스, 초안 경고, 형식에 따라 파일 이름 미리보기, 받으면 서버 이름으로 저장하고 버튼으로 돌아온다', async () => {
    const user = userEvent.setup()
    const exported = vi.fn(file('업무일지_2026-10-07_김하늘.docx'))
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
      'GET /api/worklog/logs/daily/2026-10-07/export': exported,
    })
    renderApp('/logs/daily/2026-10-07')

    const { button, dialog } = await openExport(user)
    const pdf = within(dialog).getByRole('radio', { name: /PDF/ })
    await waitFor(() => expect(pdf).toHaveFocus())
    expect(pdf).toBeChecked()
    expect(within(dialog).getByRole('note')).toHaveTextContent('확정 전 일지예요')
    expect(within(dialog).getByText('업무일지_2026-10-07_김하늘.pdf')).toBeInTheDocument()

    // 같은 묶음 안에서는 방향키로 고른다
    await user.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('radio', { name: /Word/ })).toBeChecked()
    expect(within(dialog).getByText('업무일지_2026-10-07_김하늘.docx')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '내려받기' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '내보내기' })).not.toBeInTheDocument())
    expect(exported).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(fetch).mock.calls.find(([u]) => String(u).includes('/export'))![0])).toBe(
      '/api/worklog/logs/daily/2026-10-07/export?format=DOCX',
    )
    expect(saved).toEqual(['업무일지_2026-10-07_김하늘.docx'])
    expect(await screen.findByText('파일을 내려받았어요')).toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('텍스트 복사: 서식명세 3.4 형식으로 클립보드에 넣는다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
      'GET /api/worklog/tasks/t-1': () => json(200, { id: 't-1', title: '결제 API 설계' }),
    })
    renderApp('/logs/daily/2026-10-07')

    const { dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('radio', { name: /텍스트 복사/ }))
    expect(within(dialog).queryByText(/^업무일지_/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '복사' }))

    expect(await screen.findByText('일지를 복사했어요')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(
      [
        '업무일지 [초안] · 2026년 10월 7일 (수) · 김하늘(개발팀)',
        '',
        '■ 금일 실적',
        '1. 결제 API 설계 — 엔드포인트 6개 확정 (70%)',
        '',
        '■ 진행 현황',
        '진행 중 1건 (결제 API 설계 70%)',
        '',
        '■ 다음 근무일 계획',
        '1. 스프린트 리뷰 발표 (10/8 (목) 10:00)',
        '',
        '■ 이슈 및 특이사항',
        '한빛상사 견적 회신 지연',
      ].join('\n'),
    )
  })

  it('진행 현황 괄호는 업무명(지금 제목)으로, 같은 업무는 마지막 줄 진행률로 한 번, 업무 없는 줄은 실적 문구(서식명세 2.5)', async () => {
    const user = userEvent.setup()
    const log = draft()
    const line = log.content.achievements[0]
    log.content.achievements = [
      { ...line, text: '엔드포인트 설계', progress: 70 },
      { ...line, id: 'a-2', taskId: null, text: '회의록 정리', result: null, progress: null, recordIds: ['r-2'] },
      { ...line, id: 'a-3', text: '스키마 검토', result: null, progress: 80, recordIds: ['r-3'] },
    ]
    log.content.metrics = { ...log.content.metrics, recordCount: 3, inProgress: 3 }
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, log),
      'GET /api/worklog/tasks/t-1': () => json(200, { id: 't-1', title: '결제 API 구축' }),
    })
    renderApp('/logs/daily/2026-10-07')

    // 문서 영역과 텍스트 복사가 같은 줄을 쓴다
    const progress = '진행 중 3건 (회의록 정리, 결제 API 구축 80%)'
    expect(await screen.findByText(progress)).toBeInTheDocument()
    const { dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('radio', { name: /텍스트 복사/ }))
    await user.click(within(dialog).getByRole('button', { name: '복사' }))
    expect(await screen.findByText('일지를 복사했어요')).toBeInTheDocument()
    expect((await navigator.clipboard.readText()).split('\n')).toContain(progress)
  })

  it('처음 포커스가 고른 라디오여도 Shift+Tab은 창 밖으로 나가지 않고 마지막 자리로, 라디오 묶음은 한 자리', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
    })
    renderApp('/logs/daily/2026-10-07')

    const { dialog } = await openExport(user)
    const pdf = within(dialog).getByRole('radio', { name: /PDF/ })
    await waitFor(() => expect(pdf).toHaveFocus())
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    const submit = within(dialog).getByRole('button', { name: '내려받기' })
    expect(submit).toHaveFocus()
    // 마지막에서 Tab이면 처음(고른 라디오 하나)으로. 앞의 '텍스트 복사' 라디오에 멈추지 않는다
    await user.tab()
    expect(pdf).toHaveFocus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
  })

  it('Excel 기간 업무 기록: 기간이 틀리면 받지 않고 이유를 보이고, 맞추면 그 기간으로 받는다', async () => {
    const user = userEvent.setup()
    const exported = vi.fn(file('업무기록_2026-10-01_2026-10-07_김하늘.xlsx'))
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft('CONFIRMED')),
      'GET /api/worklog/records/export': exported,
    })
    renderApp('/logs/daily/2026-10-07')

    const { dialog } = await openExport(user)
    expect(within(dialog).queryByRole('note')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: /Excel/ }))
    expect(within(dialog).getByRole('radio', { name: '이 일지' })).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: '기간 업무 기록' }))

    const from = within(dialog).getByLabelText('시작일')
    await user.clear(from)
    await user.type(from, '2026-10-09')
    expect(within(dialog).getByText('종료일이 시작일보다 빨라요')).toBeInTheDocument()
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: '내려받기' })).toBeDisabled()

    await user.clear(from)
    await user.type(from, '2025-09-01')
    expect(within(dialog).getByText('400일까지 내보낼 수 있어요')).toBeInTheDocument()

    await user.clear(from)
    await user.type(from, '2026-10-01')
    expect(within(dialog).getByText('업무기록_2026-10-01_2026-10-07_김하늘.xlsx')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '내려받기' }))

    await waitFor(() => expect(exported).toHaveBeenCalled())
    expect(
      vi.mocked(fetch).mock.calls.some(([u]) => u === '/api/worklog/records/export?from=2026-10-01&to=2026-10-07'),
    ).toBe(true)
    expect(saved).toEqual(['업무기록_2026-10-01_2026-10-07_김하늘.xlsx'])
  })

  it('서버가 503이면 창을 닫지 않고 다시 시도하라고 알리고, 포커스는 [내려받기]로 돌아온다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
      'GET /api/worklog/logs/daily/2026-10-07/export': () => problem(503, 'IDENTITY_UNAVAILABLE'),
    })
    renderApp('/logs/daily/2026-10-07')

    const { dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('button', { name: '내려받기' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요')
    expect(within(dialog).getByRole('button', { name: '내려받기' })).toBeEnabled()
    // 누른 버튼이 만드는 동안 disabled라 포커스가 body로 빠지지 않게 되돌린다
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '내려받기' })).toHaveFocus())
  })
})

describe('내보내기 전 이메일 인증 (SCR-LOG-06)', () => {
  it('미인증이면 먼저 묻고, 코드를 맞히면 고른 내보내기를 이어서 한다', async () => {
    const user = userEvent.setup()
    let me = { ...VERIFIED, emailVerified: false }
    const exported = vi.fn(file('업무일지_2026-10-07_김하늘.pdf'))
    const sent = vi.fn(() => json(202, { expiresAt: later(600), resendAvailableAt: later(60) }))
    stubFetch({
      'GET /api/users/me': () => json(200, me),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
      'POST /api/users/me/email-verification': sent,
      'GET /api/users/me/email-verification': () =>
        json(200, { verified: false, expiresAt: later(420), attemptsRemaining: 5, resendAvailableAt: null }),
      'POST /api/users/me/email-verification/confirm': () => {
        me = { ...me, emailVerified: true, version: 1 }
        return json(200, me)
      },
      'GET /api/worklog/logs/daily/2026-10-07/export': exported,
    })
    renderApp('/logs/daily/2026-10-07')

    const { button, dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('button', { name: '내려받기' }))
    const ask = await screen.findByRole('dialog', { name: '이메일 인증이 필요해요' })
    expect(exported).not.toHaveBeenCalled()
    await waitFor(() => expect(within(ask).getByRole('button', { name: '인증 코드 받기' })).toHaveFocus())
    await user.keyboard('{Enter}')

    const verify = await screen.findByRole('dialog', { name: '이메일 인증' })
    // 버튼 이름대로 코드를 먼저 보낸다
    expect(sent).toHaveBeenCalledTimes(1)
    const code = within(verify).getByRole('textbox', { name: '인증번호' })
    await waitFor(() => expect(code).toHaveFocus())
    await user.type(code, '123456')

    await waitFor(() => expect(exported).toHaveBeenCalledTimes(1))
    expect(saved).toEqual(['업무일지_2026-10-07_김하늘.pdf'])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('[취소]하면 아무것도 받지 않고 원래 버튼으로 돌아온다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, { ...VERIFIED, emailVerified: false }),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
    })
    renderApp('/logs/daily/2026-10-07')

    const { button, dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('radio', { name: /텍스트 복사/ }))
    await user.click(within(dialog).getByRole('button', { name: '복사' }))
    const ask = await screen.findByRole('dialog', { name: '이메일 인증이 필요해요' })
    await user.click(within(ask).getByRole('button', { name: '취소' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('인증한 줄 알았는데 서버가 403이면 인증 단계로 보낸다', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft()),
      'GET /api/worklog/logs/daily/2026-10-07/export': () => problem(403, 'EMAIL_NOT_VERIFIED'),
    })
    renderApp('/logs/daily/2026-10-07')

    const { dialog } = await openExport(user)
    await user.click(within(dialog).getByRole('button', { name: '내려받기' }))
    expect(await screen.findByRole('dialog', { name: '이메일 인증이 필요해요' })).toBeInTheDocument()
  })
})

describe('내보내기 바로가기', () => {
  it('홈 오늘 일지: 확정했으면 [하루 마감] 자리에 [내보내기]', async () => {
    const user = userEvent.setup()
    stubFetch({
      'GET /api/users/me': () => json(200, VERIFIED),
      'GET /api/worklog/logs/daily/2026-10-07': () => json(200, draft('CONFIRMED')),
    })
    renderApp('/')

    const card = await screen.findByRole('region', { name: '오늘 일지' })
    const button = await within(card).findByRole('button', { name: '내보내기' })
    expect(within(card).queryByRole('button', { name: '하루 마감' })).not.toBeInTheDocument()
    await user.click(button)
    expect(await screen.findByRole('dialog', { name: '내보내기' })).toHaveTextContent('2026년 10월 7일 (수) 업무일지')
  })
})

describe('파일 이름 (Content-Disposition, RFC 6266)', () => {
  it('filename*를 먼저 풀고, 없거나 깨졌으면 filename', () => {
    expect(fileNameOf(`attachment; filename="a.pdf"; filename*=UTF-8''%EC%97%85%EB%AC%B4.pdf`)).toBe('업무.pdf')
    expect(fileNameOf('attachment; filename="worklog_2026-10-07.pdf"')).toBe('worklog_2026-10-07.pdf')
    expect(fileNameOf(`attachment; filename="a.pdf"; filename*=UTF-8''%E0%A4`)).toBe('a.pdf')
    expect(fileNameOf(null)).toBeNull()
  })
})

// 주간·월간 일지 문서 (SCR-LOG-02, P3-07, 업무일지_서식명세 2.3~2.5): 포함된 날 표·월간 요약 줄, 한 날·기록 일수 칸, 월간 프로젝트별 실적 표
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkLog } from '../logs/api'
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

type Content = WorkLog['content']
type Day = Content['days'][number]

const day = (date: string, source: Day['source'], workday = true): Day =>
  ({ date, workday, holiday: null, source }) as Day

function periodLog(type: 'WEEKLY' | 'MONTHLY', start: string, end: string, content: Partial<Content>): WorkLog {
  return {
    id: 'log-p',
    type,
    periodStart: start,
    periodEnd: end,
    status: 'CONFIRMED',
    version: 1,
    confirmedAt: '2026-10-07T09:00:00Z',
    sourceChangedAfterConfirm: false,
    planCandidates: [],
    content: {
      title: type === 'WEEKLY' ? '주간 업무일지' : '월간 업무일지',
      planTitle: type === 'WEEKLY' ? '다음 주 계획' : '다음 달 계획',
      planPeriod: { start: '2026-10-12', end: '2026-10-18' },
      author: { name: '김하늘', organization: null, position: null },
      achievementsAuto: true,
      achievements: [
        {
          id: 'a-1',
          source: 'RECORD',
          text: '견적서 작성',
          result: '발송',
          outcome: 'DONE',
          progress: null,
          taskId: 't-1',
          projectName: null,
          recordIds: ['r-1', 'r-2'],
          dates: ['2026-10-05', '2026-10-07'],
          durationMin: null,
        },
      ],
      plans: [],
      issues: null,
      metrics: {
        recordCount: 2,
        done: 1,
        reviewRequested: 0,
        inProgress: 0,
        completedTaskCount: 1,
        pendingCount: 0,
        totalMin: null,
      },
      days: [],
      projects: [],
      time: null,
      ...content,
    },
  }
}

describe('주간·월간 일지 문서 (SCR-LOG-02, P3-07)', () => {
  it('주간: 포함된 날 7칸에 출처(확정·원본 기록·기록 없음·휴일, 오늘 이후는 빈칸)와 안내 줄, 실적 표에 한 날, 진행 현황은 결과별 건수', async () => {
    const days = [
      day('2026-10-05', 'CONFIRMED_LOG'),
      day('2026-10-06', 'NONE'),
      day('2026-10-07', 'RECORDS'),
      day('2026-10-08', 'NONE'),
      day('2026-10-09', 'NONE'),
      day('2026-10-10', 'NONE', false),
      day('2026-10-11', 'NONE', false),
    ]
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/logs/weekly/2026-10-05': () =>
        json(
          200,
          periodLog('WEEKLY', '2026-10-05', '2026-10-11', {
            days,
            // 서버는 주간에도 projects를 채운다. 진행 현황 판별은 형식(type)으로
            projects: [{ projectId: 'p-1', name: '결제 개편', completedTaskCount: 1, recordCount: 2, minutes: null }],
          }),
        ),
    })
    renderApp('/logs/weekly/2026-10-05')

    const heading = await screen.findByRole('heading', { name: '포함된 날' })
    const table = within(heading.closest('section')!).getByRole('table')
    const cells = within(table)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    // 오늘은 10/7(수): 10/8·10/9의 '기록 없음'은 빈칸
    expect(cells).toEqual(['확정', '기록 없음', '원본 기록', '', '', '휴일', '휴일'])
    expect(screen.getByText('원본 기록 = 확정 전이라 그날 기록에서 가져온 날')).toBeInTheDocument()

    expect(screen.getByRole('columnheader', { name: '한 날' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /견적서 작성/ })).toHaveTextContent('월·수')
    expect(screen.getByText('완료 1건')).toBeInTheDocument()
    expect(screen.queryByText(/완료 업무/)).not.toBeInTheDocument()
    // 주간은 프로젝트별 실적 표가 없다(월간만)
    expect(screen.queryByRole('columnheader', { name: '비중' })).not.toBeInTheDocument()
  })

  it('주간: 원본 기록인 날이 없으면 안내 줄을 보이지 않는다', async () => {
    const days = ['05', '06', '07', '08', '09', '10', '11'].map((d) => day(`2026-10-${d}`, 'CONFIRMED_LOG'))
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/logs/weekly/2026-10-05': () =>
        json(200, periodLog('WEEKLY', '2026-10-05', '2026-10-11', { days })),
    })
    renderApp('/logs/weekly/2026-10-05')

    await screen.findByRole('heading', { name: '포함된 날' })
    expect(screen.queryByText(/원본 기록 = /)).not.toBeInTheDocument()
  })

  it('월간: 포함된 날은 요약 한 줄, 실적 표에 기록 일수, 진행 현황에 프로젝트별 실적 표와 합계', async () => {
    const days = [
      day('2026-10-01', 'CONFIRMED_LOG'),
      day('2026-10-02', 'CONFIRMED_LOG'),
      day('2026-10-03', 'NONE', false),
      day('2026-10-05', 'RECORDS'),
    ]
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      // 화면 경로는 /logs/monthly/2026-10, API는 1일로 바꿔 부른다
      'GET /api/worklog/logs/monthly/2026-10-01': () =>
        json(
          200,
          periodLog('MONTHLY', '2026-10-01', '2026-10-31', {
            days,
            projects: [
              { projectId: 'p-1', name: '결제 개편', completedTaskCount: 1, recordCount: 2, minutes: null },
              { projectId: null, name: null, completedTaskCount: 0, recordCount: 3, minutes: null },
            ],
          }),
        ),
    })
    renderApp('/logs/monthly/2026-10')

    expect(await screen.findByText(/확정 일간 2일 · 원본 기록 1일 ·\s*휴일 1일/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '포함된 날' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '기록 일수' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /견적서 작성/ })).toHaveTextContent('2일')

    expect(screen.getByText('완료 업무 1건 · 기록 2건')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /프로젝트 없음/ })).toHaveTextContent('03')
    expect(screen.getByRole('row', { name: /합계/ })).toHaveTextContent('합계15')
    // 시간 기록 옵션이 꺼져 있으면(minutes null) 소요시간·비중 칸이 없다
    expect(screen.queryByRole('columnheader', { name: '비중' })).not.toBeInTheDocument()
  })
})

describe('소요시간 표 (SCR-LOG-02, 카드 20261008-1910)', () => {
  it('업무 칸은 실적 문장이 아니라 업무 제목, 업무 없는 기록은 "업무 없음"', async () => {
    const log = periodLog('WEEKLY', '2026-10-05', '2026-10-11', {
      time: {
        from: '2026-10-05',
        to: '2026-10-11',
        totalMin: 90,
        recordCount: 3,
        projects: [],
        tasks: [
          { taskId: 't-1', title: '견적서 보내기', projectId: null, minutes: 60 },
          { taskId: null, title: null, projectId: null, minutes: 30 },
        ],
      },
    })
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/logs/weekly/2026-10-05': () => json(200, log),
    })
    renderApp('/logs/weekly/2026-10-05')

    const heading = await screen.findByRole('heading', { name: '소요시간' })
    const table = within(heading.closest('section')!).getByRole('table')
    // 실적 줄 문장은 '견적서 작성'이지만 소요시간 표는 업무 제목
    expect(within(table).getByRole('row', { name: /견적서 보내기/ })).toHaveTextContent('67%')
    expect(within(table).getByRole('row', { name: /업무 없음/ })).toHaveTextContent('33%')
    expect(within(table).queryByText('견적서 작성')).not.toBeInTheDocument()
  })
})

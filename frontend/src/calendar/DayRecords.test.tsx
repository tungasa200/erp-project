// SCR-CAL-02 ③ 이날의 기록 접기(X-07 D): 접어도 요약 한 줄과 펼치기를 남기고, 접힘은 이 기기에 기억한다.
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerDayCloseOpener } from '../logs/openDayClose'
import { ME, json, renderApp, stubFetch } from '../test/renderApp'
import { DayRecords } from './DayRecords'

afterEach(() => {
  vi.unstubAllGlobals()
})

const DATE = '2026-10-14'

const record = (id: string, status: string) => ({
  id,
  status,
  workDate: DATE,
  content: `기록 ${id}`,
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: null,
  occurrenceStart: null,
  result: null,
  outcome: null,
  progress: null,
  startAt: null,
  endAt: null,
  durationMin: null,
  deletedAt: null,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
  version: 0,
})

function setup(now = Date.now()) {
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: 'Asia/Seoul', weekStart: 'MONDAY', workDays: 31 },
        settings: { timeTrackingEnabled: false, version: 0 },
      }),
    'GET /api/worklog/records': () =>
      json(200, { items: [record('a', 'CONFIRMED'), record('b', 'CONFIRMED'), record('c', 'DISMISSED')] }),
    'GET /api/worklog/logs': () =>
      json(200, {
        items: [{ type: 'DAILY', periodStart: DATE, periodEnd: DATE, logId: 'l-1', status: 'DRAFT' }],
        unconfirmedDays: 1,
      }),
  })
  renderApp('/', [
    {
      path: '/',
      element: (
        <DayRecords
          date={DATE}
          timeZone="Asia/Seoul"
          occurrences={[]}
          now={now}
          editable
          onOpen={vi.fn()}
          onAdd={vi.fn()}
        />
      ),
    },
  ])
  return fetchMock
}

const logCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/worklog/logs'))

describe('이날의 기록 접기 (X-07 D)', () => {
  it('기본은 펼침이고 일지 상태는 묻지 않는다. 접으면 요약 한 줄·펼치기, 다시 열어도 접힌 채(이 기기에 기억)', async () => {
    const fetchMock = setup()
    expect(await screen.findByText('기록 a')).toBeInTheDocument()
    expect(logCalls(fetchMock)).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '이날의 기록 접기' }))
    expect(screen.queryByText('기록 a')).toBeNull()
    expect(await screen.findByText('3건 · 일지 초안')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이날의 기록 펼치기' })).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(localStorage.getItem('wy.calendar.dayPanels')!)).toMatchObject({ records: false })

    cleanup()
    setup()
    expect(await screen.findByRole('button', { name: '이날의 기록 펼치기' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '이날의 기록 펼치기' }))
    expect(await screen.findByText('기록 a')).toBeInTheDocument()
  })
})

describe('[하루 마감] 링크', () => {
  it('오늘·지난 날에는 머리 아래에 있고 누르면 그날로 하루 마감을 연다', async () => {
    const opener = vi.fn()
    const release = registerDayCloseOpener(opener)
    setup(Date.parse(`${DATE}T03:00:00Z`))
    await userEvent.click(await screen.findByRole('button', { name: '하루 마감' }))
    expect(opener).toHaveBeenCalledWith({ date: DATE })
    release()
  })

  it('앞날에는 없다', async () => {
    setup(Date.parse('2026-10-13T03:00:00Z'))
    expect(await screen.findByText('기록 a')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '하루 마감' })).toBeNull()
  })
})

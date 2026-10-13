// SCR-CAL-02 ③ 이날의 기록 접기(X-07 D): 접어도 요약 한 줄과 펼치기를 남기고, 접힘은 이 기기에 기억한다.
import { cleanup, screen, waitFor } from '@testing-library/react'
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

function setup(
  now = Date.now(),
  logStatus = 'CONFIRMED',
  items: unknown[] = [record('a', 'CONFIRMED'), record('b', 'CONFIRMED'), record('c', 'DISMISSED')],
) {
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: 'Asia/Seoul', weekStart: 'MONDAY', workDays: 31 },
        settings: { timeTrackingEnabled: false, version: 0 },
      }),
    'GET /api/worklog/records/pending': () => json(200, { items: [] }),
    'GET /api/worklog/records': () => json(200, { items }),
    'GET /api/worklog/logs': () =>
      json(200, {
        items: [{ type: 'DAILY', periodStart: DATE, periodEnd: DATE, logId: 'l-1', status: logStatus }],
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
  it('기본은 펼침이고 머리에 접힌 요약과 같은 말(UX-M-REC-56). 접으면 요약 한 줄·펼치기, 다시 열어도 접힌 채(이 기기에 기억)', async () => {
    const fetchMock = setup()
    expect(await screen.findByText('기록 a')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: /3건\s*· 마감함/ })).toBeInTheDocument())
    expect(logCalls(fetchMock)).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: '이날의 기록 접기' }))
    expect(screen.queryByText('기록 a')).toBeNull()
    // 업무일지 숨김(D-214): 확정이면 '마감함'
    expect(await screen.findByText('3건 · 마감함')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이날의 기록 펼치기' })).toHaveAttribute('aria-expanded', 'false')
    // 포커스는 그 자리의 새 버튼으로(UX-CAL-174)
    expect(screen.getByRole('button', { name: '이날의 기록 펼치기' })).toHaveFocus()
    expect(JSON.parse(localStorage.getItem('wy.calendar.dayPanels')!)).toMatchObject({ records: false })

    cleanup()
    setup()
    expect(await screen.findByRole('button', { name: '이날의 기록 펼치기' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '이날의 기록 펼치기' }))
    expect(await screen.findByText('기록 a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이날의 기록 접기' })).toHaveFocus()
  })

  it('일지가 초안이면 접힌 요약에 상태를 붙이지 않는다(D-214)', async () => {
    setup(Date.now(), 'DRAFT')
    await userEvent.click(await screen.findByRole('button', { name: '이날의 기록 접기' }))
    expect(await screen.findByText('3건')).toBeInTheDocument()
    // 펼친 머리에도 붙이지 않는다
    await userEvent.click(screen.getByRole('button', { name: '이날의 기록 펼치기' }))
    expect(screen.queryByText(/초안|마감함/)).toBeNull()
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

describe('기록이 많은 날 (UX-M-REC-56)', () => {
  it('머리에 건수, 결과 글 없는 했어요는 한 줄, 6건 이상이면 끝난 기록만 5번째 뒤로 접는다', async () => {
    const items = [
      { ...record('r1', 'CONFIRMED'), result: '초안 공유' },
      ...['r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((id) => record(id, 'CONFIRMED')),
      record('p1', 'PENDING'),
    ]
    setup(Date.now(), 'CONFIRMED', items)
    await screen.findByText('기록 r1')
    // jsdom은 인라인 span 사이 공백을 이름에서 지운다. 보이는 글은 '이날의 기록 · 8건 · 대기 1 · 마감함'
    expect(await screen.findByRole('heading', { name: /^이날의 기록\s*· 8건 · 대기 1 · 마감함$/ })).toBeInTheDocument()
    // 결과 글이 있으면 카드, 없으면 한 줄(낭독용 '했어요')
    expect(screen.getByText('기록 r1').closest('button')).toHaveTextContent('초안 공유')
    expect(screen.getByRole('button', { name: /^했어요,\s*기록 r2$/ })).toBeInTheDocument()

    // 처음 5건 + 접히지 않는 확인 대기. r6·r7은 접힘
    expect(screen.queryByText('기록 r6')).toBeNull()
    expect(screen.getByText('기록 p1')).toBeInTheDocument()
    const fold = screen.getByRole('button', { name: '나머지 2건 펼치기' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fold)
    expect(screen.getByText('기록 r7')).toBeInTheDocument()
    expect(fold).toHaveAccessibleName('접기')
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(fold)
    expect(screen.queryByText('기록 r7')).toBeNull()
    expect(fold).toHaveFocus()
  })

  it('5건 이하는 접지 않는다', async () => {
    setup(
      Date.now(),
      'CONFIRMED',
      ['a', 'b', 'c', 'd', 'e'].map((id) => record(id, 'CONFIRMED')),
    )
    expect(await screen.findByText('기록 e')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /펼치기$/ })).toBeNull()
  })
})

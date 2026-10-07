// SCR-CAL-07 일정 상세의 [이 일정으로 타이머 시작] (P2-06, 사용자 결정 2026-10-07, D-101)
// "오늘"은 사용자 시간대 기준이라 시각은 Date.now()에서 만든다(KST·TZ=UTC 둘 다 돌린다).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp, stubFetch } from '../test/renderApp'
import type { Occurrence } from './api'
import { ScheduleDialog } from './ScheduleDialog'
import { addDays, fromZoned, todayIn } from './time'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TZ = 'Asia/Seoul'

/** 오늘(사용자 시간대) 00:00–00:30 회차. day로 날짜를 옮긴다 */
function occurrence(over: Partial<Occurrence> = {}, day = 0): Occurrence {
  const date = addDays(todayIn(TZ), day)
  const startAt = fromZoned(date, 0, TZ)
  return {
    scheduleId: 'schedule-1',
    occurrenceStart: startAt,
    title: '주간 회의',
    allDay: false,
    startAt,
    endAt: fromZoned(date, 30, TZ),
    startDate: null,
    endDate: null,
    memo: null,
    taskId: null,
    projectId: null,
    recurring: false,
    modified: false,
    version: 0,
    ...over,
  } as Occurrence
}

const scheduleOf = (o: Occurrence) => ({
  id: o.scheduleId,
  title: o.title,
  allDay: o.allDay,
  startAt: o.startAt,
  endAt: o.endAt,
  startDate: o.startDate,
  endDate: o.endDate,
  timezone: TZ,
  recurrence: null,
  taskId: null,
  memo: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
  overrides: {},
})

const timerRecord = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  status: 'CONFIRMED',
  workDate: todayIn(TZ),
  content: '배포 점검',
  taskId: null,
  projectId: null,
  tagIds: [],
  scheduleId: null,
  occurrenceStart: null,
  result: null,
  outcome: null,
  progress: null,
  startAt: new Date(Date.now() - 65_000).toISOString(),
  endAt: null,
  durationMin: null,
  deletedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  version: 0,
  ...over,
})

function setup(
  o: Occurrence,
  options: { timed?: boolean; running?: ReturnType<typeof timerRecord> | null; start?: () => Response } = {},
) {
  const sent: unknown[] = []
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: TZ, weekStart: 'MONDAY', workDays: 31 },
        settings: { timeTrackingEnabled: options.timed ?? true, version: 0 },
      }),
    [`GET /api/worklog/schedules/${o.scheduleId}`]: () => json(200, scheduleOf(o)),
    'GET /api/worklog/timer': () => json(200, { running: options.running ?? null }),
    'POST /api/worklog/timer/start': (init) => {
      sent.push(JSON.parse(String(init!.body)))
      if (options.start) return options.start()
      const stopped = options.running
        ? { record: { ...options.running, endAt: new Date().toISOString() }, discarded: false, capped: false }
        : null
      return json(200, {
        running: timerRecord({
          id: 'r-2',
          content: o.title,
          scheduleId: o.scheduleId,
          occurrenceStart: o.occurrenceStart,
        }),
        stopped,
      })
    },
  })
  const onClose = vi.fn()
  const user = userEvent.setup()
  renderApp('/', [{ path: '/', element: <Opener o={o} onClose={onClose} /> }])
  return { sent, onClose, user, fetchMock }
}

/** 캘린더처럼: 여는 버튼에서 열고, 닫히면 포커스가 그 버튼으로 돌아와야 한다. 대체 목적지(제목)도 둔다 */
function Opener({ o, onClose }: { o: Occurrence; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <h1 tabIndex={-1} data-focus-fallback>
        캘린더
      </h1>
      <button type="button" onClick={() => setOpen(true)}>
        일정 열기
      </button>
      {open && (
        <ScheduleDialog
          timeZone={TZ}
          occurrence={o}
          askScope={vi.fn()}
          onDelete={vi.fn()}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

const startButton = async () => {
  if (!screen.queryByRole('dialog')) await userEvent.click(await screen.findByRole('button', { name: '일정 열기' }))
  return screen.findByRole('button', { name: '이 일정으로 타이머 시작' })
}

describe('일정 상세 — 이 일정으로 타이머 시작 (SCR-CAL-07, P2-06)', () => {
  it('오늘의 시간 일정이면 계획 시각과 함께 보이고, 실행 중이 없으면 회차 키로 바로 시작하고 닫는다', async () => {
    const o = occurrence()
    const { sent, onClose, user } = setup(o)
    const button = await startButton()
    expect(screen.getByText('오늘 00:00~00:30 계획')).toBeInTheDocument()
    await user.click(button)
    expect(await screen.findByText('‘주간 회의’ 타이머를 시작했어요')).toBeInTheDocument()
    expect(sent).toEqual([{ scheduleId: o.scheduleId, occurrenceStart: o.occurrenceStart }])
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '일정 열기' })).toHaveFocus())
  })

  it('자정을 넘기는 계획이면 끝 시각에 다음 날을 붙인다', async () => {
    const today = todayIn(TZ)
    const startAt = fromZoned(today, 23 * 60 + 30, TZ)
    setup(occurrence({ occurrenceStart: startAt, startAt, endAt: fromZoned(addDays(today, 1), 30, TZ) }))
    await startButton()
    expect(screen.getByText('오늘 23:30~다음 날 00:30 계획')).toBeInTheDocument()
  })

  it('시간 기록 옵션이 꺼져 있으면 그리지 않는다', async () => {
    const { fetchMock, user } = setup(occurrence(), { timed: false })
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    await screen.findByDisplayValue('주간 회의')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/worklog/me', expect.anything()))
    expect(screen.queryByRole('button', { name: '이 일정으로 타이머 시작' })).toBeNull()
  })

  it('종일 일정이나 오늘이 아닌 회차에는 없다', async () => {
    const today = todayIn(TZ)
    const { user } = setup(
      occurrence({ allDay: true, startAt: null, endAt: null, startDate: today, endDate: addDays(today, 1) }),
    )
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    await screen.findByDisplayValue('주간 회의')
    await waitFor(() => expect(screen.queryByText(/계획$/)).toBeNull())
    expect(screen.queryByRole('button', { name: '이 일정으로 타이머 시작' })).toBeNull()
  })

  it('내일 회차에는 없다', async () => {
    const { fetchMock, user } = setup(occurrence({}, 1))
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    await screen.findByDisplayValue('주간 회의')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/worklog/me', expect.anything()))
    expect(screen.queryByRole('button', { name: '이 일정으로 타이머 시작' })).toBeNull()
  })

  it('다른 타이머가 돌고 있으면 전환을 묻고, [전환]하면 회차로 시작한다', async () => {
    const { sent, onClose, user } = setup(occurrence(), { running: timerRecord() })
    await user.click(await startButton())
    const confirm = await screen.findByRole('dialog', { name: '다른 업무로 전환' })
    expect(within(confirm).getByText('‘주간 회의’ 타이머를 시작할까요?')).toBeInTheDocument()
    expect(within(confirm).getByText('‘배포 점검’ 타이머는 멈추고 기록으로 남겨요')).toBeInTheDocument()
    expect(sent).toEqual([])
    await user.click(within(confirm).getByRole('button', { name: '전환' }))
    expect(await screen.findByText(/‘주간 회의’ 타이머를 시작했어요/)).toBeInTheDocument()
    expect(sent).toHaveLength(1)
    expect(onClose).toHaveBeenCalled()
    // 두 모달이 함께 닫혀도 포커스는 연 자리로(확인 창이 먼저 닫히고 일정 모달이 닫힌다)
    await waitFor(() => expect(screen.getByRole('button', { name: '일정 열기' })).toHaveFocus())
  })

  it('이 회차의 타이머가 이미 돌고 있으면 알리기만 한다', async () => {
    const o = occurrence()
    const { sent, user } = setup(o, {
      running: timerRecord({ content: '주간 회의', scheduleId: o.scheduleId, occurrenceStart: o.occurrenceStart }),
    })
    await user.click(await startButton())
    expect(await screen.findByText('이 일정의 타이머가 이미 돌고 있어요')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '다른 업무로 전환' })).toBeNull()
    expect(sent).toEqual([])
  })

  it('이미 기록한 계획(409)이나 바뀐 일정(404)이면 알리고 닫지 않는다', async () => {
    let status = 409
    const { onClose, user } = setup(occurrence(), {
      start: () => (status === 409 ? problem(409, 'ALREADY_RECORDED') : problem(404, 'NOT_FOUND')),
    })
    await user.click(await startButton())
    expect(await screen.findByText('그 계획은 이미 기록했어요')).toBeInTheDocument()
    status = 404
    await waitFor(() => expect(screen.getByRole('button', { name: '이 일정으로 타이머 시작' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '이 일정으로 타이머 시작' }))
    expect(await screen.findByText('그 일정이 바뀌었거나 취소됐어요')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('고치던 칸이 있으면 시작해도 모달을 닫지 않는다', async () => {
    const { sent, onClose, user } = setup(occurrence())
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    const title = await screen.findByDisplayValue('주간 회의')
    await user.type(title, ' 준비')
    await user.click(await startButton())
    expect(await screen.findByText('‘주간 회의’ 타이머를 시작했어요')).toBeInTheDocument()
    expect(sent).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('주간 회의 준비')).toBeInTheDocument()
  })
})

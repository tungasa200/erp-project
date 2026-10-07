// SCR-CAL-07 일정 상세의 [이 일정으로 타이머 시작] (P2-06, 사용자 결정 2026-10-07, D-101)과 ⑥ 기록 상태(사용자 결정 카드 20261008-0230)
// "오늘"은 사용자 시간대 기준이라 시각은 Date.now()에서 만든다(KST·TZ=UTC 둘 다 돌린다).
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp, stubFetch } from '../test/renderApp'
import type { Occurrence } from './api'
import { ScheduleDialog } from './ScheduleDialog'
import { addDays, formatMinutes, fromZoned, toZoned, todayIn } from './time'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TZ = 'Asia/Seoul'

/** 지금(분 단위로 내림)부터 30분 회차 — 오늘의 아직 끝나지 않은 회차. day로 날짜를 옮긴다 */
function occurrence(over: Partial<Occurrence> = {}, day = 0): Occurrence {
  const start = Math.floor(Date.now() / 60_000) * 60_000 + day * 86_400_000
  const startAt = new Date(start).toISOString()
  return {
    scheduleId: 'schedule-1',
    occurrenceStart: startAt,
    title: '주간 회의',
    allDay: false,
    startAt,
    endAt: new Date(start + 30 * 60_000).toISOString(),
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

/** 끝난 회차: 1시간 전에 시작해 30분 전에 끝남(자정 직후면 어제 회차가 된다) */
function endedOccurrence(): Occurrence {
  const start = Math.floor(Date.now() / 60_000) * 60_000 - 60 * 60_000
  const startAt = new Date(start).toISOString()
  return occurrence({ occurrenceStart: startAt, startAt, endAt: new Date(start + 30 * 60_000).toISOString() })
}

/** 화면에 적히는 계획 시각 "HH:MM~[다음 날 ]HH:MM" */
function planText(o: Occurrence) {
  const s = toZoned(o.startAt!, TZ)
  const e = toZoned(o.endAt!, TZ)
  return `오늘 ${formatMinutes(s.minutes)}~${e.date === s.date ? '' : '다음 날 '}${formatMinutes(e.minutes)} 계획`
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
  options: {
    timed?: boolean
    running?: ReturnType<typeof timerRecord> | null
    start?: () => Response
    records?: ReturnType<typeof timerRecord>[]
  } = {},
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
    'GET /api/worklog/records': () => json(200, { items: options.records ?? [] }),
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
  const onOpenRecord = vi.fn()
  const user = userEvent.setup()
  renderApp('/', [{ path: '/', element: <Opener o={o} onClose={onClose} onOpenRecord={onOpenRecord} /> }])
  return { sent, onClose, onOpenRecord, user, fetchMock }
}

/** 캘린더처럼: 여는 버튼에서 열고, 닫히면 포커스가 그 버튼으로 돌아와야 한다. 대체 목적지(제목)도 둔다 */
function Opener({
  o,
  onClose,
  onOpenRecord,
}: {
  o: Occurrence
  onClose: () => void
  onOpenRecord: (...args: unknown[]) => void
}) {
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
          onOpenRecord={onOpenRecord}
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
    expect(screen.getByText(planText(o))).toBeInTheDocument()
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

  it('이미 끝난 회차에는 없다(WY-pm 결정)', async () => {
    const { fetchMock, user } = setup(endedOccurrence())
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    await screen.findByDisplayValue('주간 회의')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/worklog/me', expect.anything()))
    expect(screen.queryByRole('button', { name: '이 일정으로 타이머 시작' })).toBeNull()
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

  it('끊겼으면 버튼을 끄고 옆에 연결 끊김을 알린다(SCR-SYS-02 ③, SCR-COM-06과 같게)', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      setup(occurrence())
      const button = await startButton()
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription('연결 끊김')
      expect(button).toHaveAttribute('title', '연결되면 타이머를 시작할 수 있어요')
    } finally {
      onLine.mockRestore()
    }
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

describe('일정 상세 — ⑥ 기록 상태 (SCR-CAL-07)', () => {
  const linked = (o: Occurrence, over: Record<string, unknown>) =>
    timerRecord({ id: 'r-9', content: o.title, scheduleId: o.scheduleId, occurrenceStart: o.occurrenceStart, ...over })

  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: '일정 열기' }))
    await screen.findByDisplayValue('주간 회의')
  }

  it('확인 대기 기록이면 상태를 보이고, [기록 보기]는 이 창을 닫고 계획 시각과 함께 기록 창을 연다', async () => {
    const o = endedOccurrence()
    const pending = linked(o, { status: 'PENDING', startAt: null })
    const { onClose, onOpenRecord, user } = setup(o, { records: [pending] })
    await openDialog(user)
    expect(await screen.findByText('확인 대기')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '기록 보기' }))
    expect(onClose).toHaveBeenCalled()
    expect(onOpenRecord).toHaveBeenCalledWith(pending, { startAt: o.startAt, endAt: o.endAt })
  })

  it('했어요 기록이면 시간 기록 옵션이 켜졌을 때 기록 시간을 적는다', async () => {
    const o = endedOccurrence()
    const startAt = o.startAt!
    const endAt = new Date(Date.parse(startAt) + 25 * 60_000).toISOString()
    const { user } = setup(o, { records: [linked(o, { startAt, endAt })] })
    await openDialog(user)
    expect(await screen.findByText('했어요')).toBeInTheDocument()
    const time = `${formatMinutes(toZoned(startAt, TZ).minutes)}–${toZoned(endAt, TZ).date === toZoned(startAt, TZ).date ? '' : '다음 날 '}${formatMinutes(toZoned(endAt, TZ).minutes)}`
    expect(screen.getByText(time)).toBeInTheDocument()
  })

  it('이미 했어요·안 했어요로 기록한 회차면 아직 끝나지 않았어도 타이머 시작 띠를 숨긴다(WY-pm 결정)', async () => {
    for (const status of ['CONFIRMED', 'DISMISSED']) {
      const o = occurrence()
      const { user } = setup(o, { records: [linked(o, { status, startAt: null })] })
      await openDialog(user)
      expect(await screen.findByText(status === 'CONFIRMED' ? '했어요' : '안 했어요')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '이 일정으로 타이머 시작' })).toBeNull()
      expect(screen.queryByText(planText(o))).toBeNull()
      cleanup()
    }
  })

  it('확인 대기 기록이나 이 회차로 돌고 있는 타이머면 띠를 둔다', async () => {
    for (const over of [{ status: 'PENDING', startAt: null }, {}]) {
      const o = occurrence()
      setup(o, { records: [linked(o, over)] })
      await startButton()
      cleanup()
    }
  })

  it('안 했어요 기록은 옵션이 꺼져 있으면 시간 없이 상태만 보인다', async () => {
    const o = endedOccurrence()
    const { user } = setup(o, { timed: false, records: [linked(o, { status: 'DISMISSED', startAt: null })] })
    await openDialog(user)
    expect(await screen.findByText('안 했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '기록 보기' })).toBeInTheDocument()
  })

  it('끝난 회차에 기록이 없으면 없다고 적는다', async () => {
    const { user } = setup(endedOccurrence())
    await openDialog(user)
    expect(await screen.findByText('이 일정에서 남긴 기록이 없어요')).toBeInTheDocument()
  })

  it('아직 끝나지 않은 회차는 기록이 없으면 ⑥을 그리지 않는다', async () => {
    const { fetchMock, user } = setup(occurrence())
    await openDialog(user)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/worklog\/records\?/), expect.anything()),
    )
    expect(screen.queryByText('이 일정에서 남긴 기록이 없어요')).toBeNull()
    expect(screen.queryByRole('button', { name: '기록 보기' })).toBeNull()
  })
})

// SCR-COM-06 타이머 미니 플레이어 (TIME-03·10, P2-06, D-101)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp, stubFetch } from '../test/renderApp'
import { TimerMiniPlayer } from './TimerMiniPlayer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const record = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  status: 'CONFIRMED',
  workDate: '2026-10-07',
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

const NEXT = {
  scheduleId: 's-1',
  occurrenceStart: '2026-10-07T05:00:00Z',
  title: '주간 회의',
  taskId: null,
  startAt: '2026-10-07T05:00:00Z',
  endAt: '2026-10-07T06:00:00Z',
}

type Handlers = Parameters<typeof stubFetch>[0]

/** running: 처음 실행 중인 타이머. 시작하면 응답의 running으로 바뀌고 정지하면 null */
function server(options: { timed?: boolean; running?: ReturnType<typeof record> | null; handlers?: Handlers } = {}) {
  const sent: { key: string; body: unknown }[] = []
  let running = options.running === undefined ? record() : options.running
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: 'Asia/Seoul', weekStart: 'MONDAY', workDays: 31 },
        settings: { timeTrackingEnabled: options.timed ?? true, version: 0 },
      }),
    'GET /api/worklog/timer': () => json(200, { running }),
    'POST /api/worklog/timer/stop': () => {
      sent.push({ key: 'stop', body: null })
      const stopped = running && {
        record: { ...running, endAt: new Date().toISOString() },
        discarded: false,
        capped: false,
      }
      running = null
      return json(200, { stopped, next: null })
    },
    ...Object.fromEntries(
      Object.entries(options.handlers ?? {}).map(([k, h]) => [
        k,
        async (init: RequestInit | undefined) => {
          sent.push({ key: k, body: init?.body ? JSON.parse(String(init.body)) : null })
          const res = await h(init)
          if (k.endsWith('/stop') && res.ok) running = null
          if (k.endsWith('/start') && res.ok)
            running = ((await res.clone().json()) as { running: typeof running }).running
          return res
        },
      ]),
    ),
  })
  return { sent, fetchMock }
}

function show() {
  const user = userEvent.setup()
  renderApp('/', [
    {
      path: '/',
      element: (
        <>
          <h1 tabIndex={-1}>홈</h1>
          <TimerMiniPlayer />
        </>
      ),
    },
  ])
  return user
}

describe('타이머 미니 플레이어 (SCR-COM-06)', () => {
  it('시간 기록 옵션이 꺼져 있으면 타이머가 돌아도 그리지 않고 타이머를 묻지도 않는다', async () => {
    const { fetchMock } = server({ timed: false })
    show()
    await screen.findByRole('heading', { name: '홈' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/worklog/me', expect.anything()))
    expect(screen.queryByRole('region', { name: /타이머/ })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/worklog/timer')).toBe(false)
  })

  it('실행 중이면 업무명과 서버 시작 시각 기준 경과 시간을 보이고, 정지하면 기록 토스트 뒤 사라지며 포커스는 제목으로', async () => {
    const { sent } = server()
    const user = show()
    const player = await screen.findByRole('region', { name: '타이머: 배포 점검' })
    expect(within(player).getByText('배포 점검')).toBeInTheDocument()
    expect(within(player).getByText(/^1:0\d$/)).toBeInTheDocument()
    expect(within(player).getByText('1분 지남')).toBeInTheDocument()

    await user.click(within(player).getByRole('button', { name: '정지' }))
    expect(await screen.findByText('기록을 남겼어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: /타이머/ })).toBeNull())
    expect(sent.map((s) => s.key)).toEqual(['stop'])
    expect(screen.getByRole('heading', { name: '홈' })).toHaveFocus()
  })

  it('1분 미만이면 버렸다고 알린다', async () => {
    server({
      handlers: {
        'POST /api/worklog/timer/stop': () =>
          json(200, { stopped: { record: record(), discarded: true, capped: false }, next: null }),
      },
    })
    const user = show()
    await user.click(await screen.findByRole('button', { name: '정지' }))
    expect(await screen.findByText('1분이 안 돼서 기록하지 않았어요')).toBeInTheDocument()
  })

  it('정지 뒤 이어달리기: 다음 계획을 제안하고 [시작]은 회차 키로 시작한 뒤 새 타이머의 정지 버튼으로 포커스', async () => {
    const { sent } = server({
      handlers: {
        'POST /api/worklog/timer/stop': () =>
          json(200, { stopped: { record: record(), discarded: false, capped: false }, next: NEXT }),
        'POST /api/worklog/timer/start': () =>
          json(200, {
            running: record({ id: 'r-2', content: '주간 회의', scheduleId: 's-1', startAt: new Date().toISOString() }),
            stopped: null,
          }),
      },
    })
    const user = show()
    await user.click(await screen.findByRole('button', { name: '정지' }))
    const panel = await screen.findByRole('region', { name: '타이머' })
    expect(within(panel).getByRole('status')).toHaveTextContent('기록을 남겼어요')
    expect(within(panel).getByText('다음 계획 ‘주간 회의’을(를) 시작할까요?')).toBeInTheDocument()
    const startButton = within(panel).getByRole('button', { name: '시작' })
    await waitFor(() => expect(startButton).toHaveFocus())

    await user.click(startButton)
    const player = await screen.findByRole('region', { name: '타이머: 주간 회의' })
    expect(sent.find((s) => s.key.endsWith('/start'))?.body).toEqual({
      scheduleId: 's-1',
      occurrenceStart: '2026-10-07T05:00:00Z',
    })
    await waitFor(() => expect(within(player).getByRole('button', { name: '정지' })).toHaveFocus())
  })

  it('이어달리기 회차가 이미 기록됐으면(409) 제안을 거두고 알린다. [괜찮아요]로 닫는다', async () => {
    server({
      handlers: {
        'POST /api/worklog/timer/stop': () =>
          json(200, { stopped: { record: record(), discarded: false, capped: false }, next: NEXT }),
        'POST /api/worklog/timer/start': () => problem(409, 'ALREADY_RECORDED'),
      },
    })
    const user = show()
    await user.click(await screen.findByRole('button', { name: '정지' }))
    await user.click(await screen.findByRole('button', { name: '시작' }))
    expect(await screen.findByText('그 계획은 이미 기록했어요')).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: '타이머' })
    expect(within(panel).queryByRole('button', { name: '시작' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('region', { name: /타이머/ })).toBeNull()
  })

  it('24시간에서 잘렸으면 안내와 [시간 고치기]를 남긴다', async () => {
    server({
      handlers: {
        'POST /api/worklog/timer/stop': () =>
          json(200, { stopped: { record: record(), discarded: false, capped: true }, next: null }),
      },
    })
    const user = show()
    await user.click(await screen.findByRole('button', { name: '정지' }))
    const panel = await screen.findByRole('region', { name: '타이머' })
    expect(within(panel).getByRole('status')).toHaveTextContent('24시간이 넘어 24시간까지만 기록했어요')
    expect(within(panel).getByRole('button', { name: '시간 고치기' })).toHaveFocus()
  })

  it('업무 전환: 할 일을 적어 시작하면 서버가 앞 타이머를 멈추고 새 타이머로 바뀐다', async () => {
    const { sent } = server({
      handlers: {
        'POST /api/worklog/timer/start': () =>
          json(200, {
            running: record({ id: 'r-3', content: '문서 정리', startAt: new Date().toISOString() }),
            stopped: { record: record({ endAt: new Date().toISOString() }), discarded: false, capped: false },
          }),
      },
    })
    const user = show()
    await user.click(await screen.findByRole('button', { name: '업무 전환' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 업무로 전환' })
    expect(within(dialog).getByText('‘배포 점검’ 타이머는 멈추고 기록으로 남겨요')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '전환' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('업무를 고르거나 할 일을 적어 주세요')

    await user.type(within(dialog).getByRole('textbox', { name: /할 일/ }), ' 문서 정리 ')
    await user.click(within(dialog).getByRole('button', { name: '전환' }))
    expect(await screen.findByRole('region', { name: '타이머: 문서 정리' })).toBeInTheDocument()
    expect(screen.getByText('기록을 남겼어요 · ‘문서 정리’ 타이머를 시작했어요')).toBeInTheDocument()
    expect(sent.find((s) => s.key.endsWith('/start'))?.body).toEqual({ taskId: null, content: '문서 정리' })
  })
})

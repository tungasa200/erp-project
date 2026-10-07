// SCR-REC-01 기록 추가·수정 (REC-01, TIME-04·06, P2-01 계약)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp, stubFetch } from '../test/renderApp'
import { RecordDialog } from './RecordDialog'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const record = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  status: 'CONFIRMED',
  workDate: '2026-10-07',
  content: '주간 회의',
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
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  version: 3,
  ...over,
})

function server(options: { timed?: boolean; handlers?: Parameters<typeof stubFetch>[0] } = {}) {
  const sent: { key: string; body: Record<string, unknown> | null }[] = []
  const log = (key: string, respond: () => Response) => (init: RequestInit | undefined) => {
    sent.push({ key, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null })
    return respond()
  }
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () =>
      json(200, {
        userId: ME.id,
        profile: { timezone: 'Asia/Seoul', weekStart: 'MONDAY', workDays: 31 },
        settings: { timeTrackingEnabled: options.timed ?? false, version: 0 },
      }),
    'GET /api/worklog/records': () => json(200, { items: [] }),
    'POST /api/worklog/records': log('POST', () => json(201, record({ id: 'r-new' }))),
    ...Object.fromEntries(
      Object.entries(options.handlers ?? {}).map(([k, h]) => [
        k,
        (init: RequestInit | undefined) => {
          sent.push({ key: k, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null })
          return h(init)
        },
      ]),
    ),
  })
  return { sent, fetchMock }
}

function Harness(props: { recordId?: string; planned?: { startAt: string; endAt: string } }) {
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState<string>('')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <p>{closed}</p>
      {open && (
        <RecordDialog
          {...props}
          defaults={props.recordId ? undefined : { workDate: '2026-10-07' }}
          onClose={(changed) => {
            setOpen(false)
            setClosed(changed ? '바뀜' : '그대로')
          }}
        />
      )}
    </>
  )
}

async function open(props: { recordId?: string; planned?: { startAt: string; endAt: string } } = {}) {
  const user = userEvent.setup()
  renderApp('/', [{ path: '/', element: <Harness {...props} /> }])
  await user.click(await screen.findByRole('button', { name: '열기' }))
  const dialog = await screen.findByRole('dialog')
  return { user, dialog }
}

describe('기록 추가·수정 (SCR-REC-01)', () => {
  it('새 기록: 한 일을 비우면 인라인 오류와 포커스, 채우면 결과 칩과 함께 확정 기록을 만든다', async () => {
    const { sent } = server()
    const { user, dialog } = await open()
    const content = within(dialog).getByRole('textbox', { name: '한 일' })
    await waitFor(() => expect(content).toHaveFocus())
    // 시간 기록 옵션이 꺼져 있으면 시간 칸이 없다
    expect(within(dialog).queryByLabelText('시작')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('한 일을 적어 주세요')
    expect(content).toHaveFocus()
    expect(content).toHaveAttribute('aria-invalid', 'true')

    await user.type(content, '  배포 점검  ')
    await user.type(within(dialog).getByRole('textbox', { name: '결과 한 줄' }), '문제 없음')
    await user.click(within(dialog).getByRole('radio', { name: '진행 중 0%' }))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(sent.find((x) => x.key === 'POST')?.body).toEqual({
      content: '배포 점검',
      taskId: null,
      workDate: '2026-10-07',
      result: '문제 없음',
      outcome: 'IN_PROGRESS',
      progress: 0,
    })
    // 닫으면 연 자리로 포커스가 돌아온다
    expect(screen.getByRole('button', { name: '열기' })).toHaveFocus()
  })

  it('확인 대기 기록을 고치면 출처를 보이고, 바꾼 칸과 status=CONFIRMED를 한 요청으로 보낸다', async () => {
    const pending = record({
      status: 'PENDING',
      scheduleId: 's-1',
      occurrenceStart: '2026-10-07T01:00:00Z',
      content: '주간 회의',
    })
    const { sent } = server({
      handlers: {
        'GET /api/worklog/records/r-1': () => json(200, pending),
        'PATCH /api/worklog/records/r-1': () => json(200, { ...pending, status: 'CONFIRMED', version: 4 }),
      },
    })
    const { user, dialog } = await open({ recordId: 'r-1' })
    expect(await within(dialog).findByRole('heading', { name: '확인 대기 수정' })).toBeInTheDocument()
    expect(within(dialog).getByText(/계획에서 온 기록 · 10\/7\(수\) 10:00 회차/)).toBeInTheDocument()
    const content = within(dialog).getByRole('textbox', { name: '한 일' })
    await waitFor(() => expect(content).toHaveFocus())
    await user.clear(content)
    await user.type(content, '주간 회의 — 일정 조정')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(sent.find((x) => x.key.startsWith('PATCH'))?.body).toEqual({
      version: 3,
      content: '주간 회의 — 일정 조정',
      status: 'CONFIRMED',
    })
  })

  it('확인 대기 기록은 시작·종료 칸을 계획 시각으로 채우고, 그대로 저장해도 시각과 status=CONFIRMED를 보낸다', async () => {
    const pending = record({ status: 'PENDING', scheduleId: 's-1', occurrenceStart: '2026-10-07T01:00:00Z' })
    const { sent } = server({
      timed: true,
      handlers: {
        'GET /api/worklog/records/r-1': () => json(200, pending),
        'PATCH /api/worklog/records/r-1': () => json(200, { ...pending, status: 'CONFIRMED', version: 4 }),
      },
    })
    const { user, dialog } = await open({
      recordId: 'r-1',
      planned: { startAt: '2026-10-07T01:00:00Z', endAt: '2026-10-07T02:00:00Z' },
    })
    expect(await within(dialog).findByLabelText('시작')).toHaveValue('10:00')
    expect(within(dialog).getByLabelText('종료')).toHaveValue('11:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(sent.find((x) => x.key.startsWith('PATCH'))?.body).toEqual({
      version: 3,
      startAt: '2026-10-07T01:00:00.000Z',
      endAt: '2026-10-07T02:00:00.000Z',
      durationMin: null,
      status: 'CONFIRMED',
    })
  })

  it('시작이 있는 기록에는 계획 시각을 덮어쓰지 않는다', async () => {
    server({
      timed: true,
      handlers: {
        'GET /api/worklog/records/r-1': () =>
          json(200, record({ startAt: '2026-10-07T03:00:00Z', endAt: '2026-10-07T04:00:00Z' })),
      },
    })
    const { dialog } = await open({
      recordId: 'r-1',
      planned: { startAt: '2026-10-07T01:00:00Z', endAt: '2026-10-07T02:00:00Z' },
    })
    expect(await within(dialog).findByLabelText('시작')).toHaveValue('12:00')
    expect(within(dialog).getByLabelText('종료')).toHaveValue('13:00')
  })

  it('시간 기록 옵션이 켜지면 시작·종료를 같이 받고, 순서가 틀리면 막고, 겹치면 경고만 한다', async () => {
    const { sent } = server({
      timed: true,
      handlers: {
        'GET /api/worklog/records': () =>
          json(200, {
            items: [
              record({
                id: 'r-other',
                content: '고객 통화',
                startAt: '2026-10-07T00:30:00Z',
                endAt: '2026-10-07T01:30:00Z',
              }),
            ],
          }),
      },
    })
    const { user, dialog } = await open()
    await user.type(within(dialog).getByRole('textbox', { name: '한 일' }), '보고서')
    const start = within(dialog).getByLabelText('시작')
    const end = within(dialog).getByLabelText('종료')

    await user.type(start, '10:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('종료 시각도 골라 주세요')
    expect(end).toHaveFocus()

    await user.type(end, '09:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('종료를 시작보다 뒤로 골라 주세요')

    await user.clear(end)
    await user.type(end, '11:00')
    // 서울 10:00~11:00 = UTC 01:00~02:00 → 고객 통화(00:30~01:30)와 겹친다
    expect(await within(dialog).findByText(/다른 기록과 시간이 겹쳐요: 고객 통화 \(09:30~10:30\)/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('또는 소요시간(분)')).toHaveValue(60)

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(sent.find((x) => x.key === 'POST')?.body).toMatchObject({
      startAt: '2026-10-07T01:00:00.000Z',
      endAt: '2026-10-07T02:00:00.000Z',
      durationMin: null,
    })
  })

  it('실행 중인 타이머는 종료 없이 고칠 수 있고, 시작은 비울 수 없다(D-101)', async () => {
    const { sent } = server({
      timed: true,
      handlers: {
        'GET /api/worklog/records/r-1': () => json(200, record({ startAt: '2026-10-07T01:00:00Z' })),
        'PATCH /api/worklog/records/r-1': () => json(200, record()),
      },
    })
    const { user, dialog } = await open({ recordId: 'r-1' })
    const start = await within(dialog).findByLabelText('시작')
    expect(start).toHaveValue('10:00')
    expect(within(dialog).getByText('타이머가 돌고 있어요. 종료를 넣으면 멈춰요')).toBeInTheDocument()

    await user.clear(start)
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('타이머의 시작 시각을 골라 주세요')
    expect(start).toHaveFocus()

    await user.type(start, '09:30')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(sent.find((x) => x.key.startsWith('PATCH'))?.body).toEqual({
      version: 3,
      startAt: '2026-10-07T00:30:00.000Z',
      endAt: null,
      durationMin: null,
    })
  })

  it('동시 수정 충돌(409)이면 충돌 띠를 보이고, 새로 불러오면 서버 값으로 채운다', async () => {
    let latest = record()
    server({
      handlers: {
        'GET /api/worklog/records/r-1': () => json(200, latest),
        'PATCH /api/worklog/records/r-1': () => {
          latest = record({ content: '다른 곳에서 고침', version: 4 })
          return problem(409, 'VERSION_CONFLICT')
        },
      },
    })
    const { user, dialog } = await open({ recordId: 'r-1' })
    const content = await within(dialog).findByRole('textbox', { name: '한 일' })
    await user.type(content, ' 추가')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText(/다른 곳에서 먼저 수정됐어요/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '새로 불러오기' }))
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: '한 일' })).toHaveValue('다른 곳에서 고침'))
    expect(within(dialog).queryByText(/다른 곳에서 먼저 수정됐어요/)).toBeNull()
  })

  it('삭제하면 닫고 되돌리기 토스트로 복원한다', async () => {
    const { sent } = server({
      handlers: {
        'GET /api/worklog/records/r-1': () => json(200, record()),
        'DELETE /api/worklog/records/r-1': () => new Response(null, { status: 204 }),
        'POST /api/worklog/records/r-1/restore': () => json(200, record()),
      },
    })
    const { user, dialog } = await open({ recordId: 'r-1' })
    await user.click(await within(dialog).findByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.getByText('바뀜')).toBeInTheDocument())
    expect(screen.getByText('기록을 삭제했어요')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(sent.some((x) => x.key === 'POST /api/worklog/records/r-1/restore')).toBe(true))
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp, stubFetch } from '../test/renderApp'
import { QuickCreate } from './QuickCreate'

const PROJECT = { id: 'project-sales', name: '영업', color: 'P2', archived: false, version: 0 }

function renderQuickCreate() {
  const onClose = vi.fn()
  const onDetails = vi.fn()
  renderApp('/', [
    {
      path: '/',
      element: (
        <QuickCreate
          target={{ date: '2026-10-07', start: 600, end: 660, allDay: false }}
          timeZone="Asia/Seoul"
          anchor={{ x: 100, y: 100 }}
          onClose={onClose}
          onDetails={onDetails}
        />
      ),
    },
  ])
  return { onClose, onDetails }
}

const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, key: string) => {
  const call = fetchMock.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}` === key)
  return call && JSON.parse(String(call[1]!.body))
}

function server(overrides: Record<string, () => Response> = {}) {
  return stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: [PROJECT] }),
    'POST /api/worklog/tags': () => json(201, { id: 'tag-quote', name: '견적', version: 0 }),
    'POST /api/worklog/tasks': () => json(201, { id: 'task-new', title: '견적 회의', version: 0 }),
    'DELETE /api/worklog/tasks/task-new': () => new Response(null, { status: 204 }),
    'POST /api/worklog/schedules': () => json(201, { id: 'schedule-new', version: 0 }),
    ...overrides,
  })
}

// 오늘을 2026-10-07(수) 서울 낮으로 고정한다(~금 → 10/09). 타이머는 그대로 둔다
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('일정 빠른 생성 해석 칩·업무로도 만들기 (P1-09-09)', () => {
  it('기본으로 켜져 있고, 해석 칩의 값으로 업무를 만들어 일정에 연결한다', async () => {
    const fetchMock = server()
    const user = userEvent.setup()
    const { onClose } = renderQuickCreate()
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    expect(within(dialog).getByRole('switch', { name: '업무로도 만들기' })).toBeChecked()

    await user.type(within(dialog).getByLabelText('한 줄 입력'), '견적 회의 15-16 @영업 #견적 !높음 ~금')
    const chips = within(dialog).getByRole('list', { name: '업무에 넣을 값' })
    expect(await within(chips).findByText('@영업')).toBeInTheDocument()
    expect(within(chips).getByText('#견적')).toBeInTheDocument()
    expect(within(chips).getByText('우선순위 높음')).toBeInTheDocument()
    expect(within(chips).getByText(/^마감 /)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^10월 7일 \(수\) 15:00–16:00, / })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(bodyOf(fetchMock, 'POST /api/worklog/tasks')).toMatchObject({
      title: '견적 회의',
      projectId: 'project-sales',
      tagIds: ['tag-quote'],
      priority: 'HIGH',
      dueDate: '2026-10-09',
    })
    expect(bodyOf(fetchMock, 'POST /api/worklog/schedules')).toMatchObject({
      title: '견적 회의',
      allDay: false,
      startAt: '2026-10-07T06:00:00.000Z',
      taskId: 'task-new',
    })
    expect(await screen.findByText('일정과 업무를 만들었어요')).toBeInTheDocument()
  })

  it('끄면 업무를 만들지 않고 @·#·!·~ 토큰을 제목에 남긴다', async () => {
    const fetchMock = server()
    const user = userEvent.setup()
    const { onClose } = renderQuickCreate()
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.click(within(dialog).getByRole('switch', { name: '업무로도 만들기' }))
    await user.type(within(dialog).getByLabelText('한 줄 입력'), '견적 회의 @영업 #견적')
    expect(within(dialog).queryByRole('list', { name: '업무에 넣을 값' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(bodyOf(fetchMock, 'POST /api/worklog/tasks')).toBeUndefined()
    expect(bodyOf(fetchMock, 'POST /api/worklog/schedules')).toMatchObject({ title: '견적 회의 @영업 #견적' })
    expect(bodyOf(fetchMock, 'POST /api/worklog/schedules').taskId).toBeUndefined()
  })

  it('없는 프로젝트면 만들기 칩을 보여 주고, 저장은 막고 오류를 입력칸에 연결한다', async () => {
    const fetchMock = server({ 'GET /api/worklog/projects': () => json(200, { items: [] }) })
    const user = userEvent.setup()
    renderQuickCreate()
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    const input = within(dialog).getByLabelText('한 줄 입력')
    await user.type(input, '킥오프 @신규')
    expect(await within(dialog).findByRole('button', { name: '+ 새 프로젝트 "신규" 만들기' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('"신규" 프로젝트가 없어요')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveFocus()
    expect(bodyOf(fetchMock, 'POST /api/worklog/tasks')).toBeUndefined()
  })

  it('일정을 못 만들면 먼저 만든 업무를 지운다', async () => {
    const fetchMock = server({ 'POST /api/worklog/schedules': () => problem(500, 'INTERNAL') })
    const user = userEvent.setup()
    const { onClose } = renderQuickCreate()
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.type(within(dialog).getByLabelText('한 줄 입력'), '견적 회의')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/task-new')),
      ).toBe(true),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeEnabled()
  })

  it('자세히로 넘길 때는 업무 토큰을 제목에 남긴다', async () => {
    server()
    const user = userEvent.setup()
    const { onDetails } = renderQuickCreate()
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.type(within(dialog).getByLabelText('한 줄 입력'), '견적 회의 @영업 14-15')
    await user.click(within(dialog).getByRole('button', { name: '자세히' }))
    expect(onDetails).toHaveBeenCalledWith(expect.objectContaining({ title: '견적 회의 @영업', start: 840, end: 900 }))
  })
})

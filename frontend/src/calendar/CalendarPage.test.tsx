import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp } from '../test/renderApp'
import { CalendarPage } from './CalendarPage'
import { handleScheduleMock } from './mockSchedules'

const routes = [
  { path: '/calendar/list', element: <CalendarPage /> },
  { path: '/calendar/:view/:date', element: <CalendarPage /> },
]

// 2026-10-07(수) 서울 10:00–11:00, 평일 반복
const standup = {
  id: 'schedule-standup',
  title: '팀 스탠드업',
  allDay: false,
  startAt: '2026-10-07T01:00:00.000Z',
  endAt: '2026-10-07T02:00:00.000Z',
  startDate: null,
  endDate: null,
  timezone: 'Asia/Seoul',
  recurrence: {
    frequency: 'WEEKLY',
    weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    until: '2026-10-09',
  },
  taskId: null,
  memo: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
  overrides: {},
}

/** 일정 요청은 가짜 일정 서버로, 나머지는 로그인 사용자·빈 프로젝트 목록으로 답한다 */
function stubServer() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/worklog/schedules')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return handleScheduleMock(method, url, body, { json, problem })!
    }
    if (url === '/api/users/me') return json(200, ME)
    if (url.startsWith('/api/worklog/projects')) return json(200, { items: [] })
    if (url === '/api/worklog/tasks' && method === 'POST') {
      const body = JSON.parse(String(init!.body))
      return json(201, task('task-new', body.title, body.dueDate ?? null))
    }
    if (url.startsWith('/api/worklog/tasks?')) {
      // 일정 없는 업무만(scheduled=false) — 일정이 연결된 업무는 빠진다
      const linked = new Set(
        JSON.parse(localStorage.getItem('worklog.mock.schedules') ?? '[]').map((x: { taskId: string }) => x.taskId),
      )
      return json(200, { items: tasks.filter((t) => !linked.has(t.id)) })
    }
    return problem(404, 'NOT_FOUND')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const task = (id: string, title: string, dueDate: string | null) => ({
  id,
  title,
  status: 'TODO',
  priority: 'NORMAL',
  progress: 0,
  dueDate,
  projectId: null,
  tagIds: [],
  hasSchedule: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
})
const tasks = [task('task-report', '9월 매출 보고서', '2026-10-06'), task('task-idea', '아이디어 정리', null)]

beforeEach(() => {
  localStorage.setItem('worklog.mock.schedules', JSON.stringify([standup]))
})

describe('캘린더', () => {
  it('주 보기: 주 시작 요일·공휴일·반복 회차를 그린다', async () => {
    stubServer()
    renderApp('/calendar/week/2026-10-07', routes)
    expect(await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })).toBeInTheDocument()
    expect(screen.getByText('대체공휴일(개천절)')).toBeInTheDocument()
    expect(screen.getByText('한글날')).toBeInTheDocument()
    // until 10/9까지 수·목·금 3회
    expect(await screen.findAllByRole('button', { name: /^팀 스탠드업, 10:00–11:00, 반복$/ })).toHaveLength(3)
  })

  it('단축키 M으로 월 보기, J로 이전 달', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.keyboard('m')
    expect(await screen.findByRole('heading', { level: 1, name: '2026년 10월' })).toBeInTheDocument()
    await user.keyboard('j')
    expect(await screen.findByRole('heading', { level: 1, name: '2026년 9월' })).toBeInTheDocument()
  })

  it('일정 만들기 → 상세 모달에서 저장하면 그리드에 나타난다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('heading', { name: '2026년 10월 5일 – 11일' })
    await user.click(screen.getByRole('button', { name: '일정 만들기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByText('일정 이름을 적어 주세요')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('제목'), '견적서 작성')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 일정' })).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    expect(await screen.findByRole('button', { name: /^견적서 작성, / })).toBeInTheDocument()
  })

  it('반복 일정 삭제: 범위를 묻고, "이 일정만"이면 그 회차만 빠진 뒤 토스트로 되돌릴 수 있다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const blocks = await screen.findAllByRole('button', { name: /^팀 스탠드업, / })
    blocks[0].focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '일정 편집' })
    await user.click(await within(dialog).findByRole('button', { name: '삭제' }))

    const scope = await screen.findByRole('alertdialog', { name: '반복 일정을 삭제할까요?' })
    expect(within(scope).getByLabelText('이 일정만')).toBeChecked()
    await user.click(within(scope).getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: /^팀 스탠드업, / })).toHaveLength(2))
    expect(screen.getByText('일정을 삭제했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^팀 스탠드업, / })).toHaveLength(3))
  })

  it('업무 패널: 마감순 카드, 날짜 없는 업무는 접고, "일정 잡기"로 업무에 연결된 일정을 만든다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const panel = await screen.findByRole('complementary', { name: '할 일 상자' })
    expect(await within(panel).findByText('9월 매출 보고서')).toBeInTheDocument()
    expect(within(panel).queryByText('아이디어 정리')).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: '날짜 없는 업무 1개 더 보기' }))
    expect(within(panel).getByText('아이디어 정리')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: '9월 매출 보고서 일정 잡기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    expect(within(dialog).getByLabelText('제목')).toHaveValue('9월 매출 보고서')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(within(panel).queryByText('9월 매출 보고서')).not.toBeInTheDocument())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ title: '9월 매출 보고서', taskId: 'task-report' })
  })

  it('P로 업무 패널을 닫고 연다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    await screen.findByRole('complementary', { name: '할 일 상자' })
    await user.keyboard('p')
    expect(screen.queryByRole('complementary', { name: '할 일 상자' })).not.toBeInTheDocument()
    await user.keyboard('p')
    expect(screen.getByRole('complementary', { name: '할 일 상자' })).toBeInTheDocument()
  })

  it('업무 패널 빠른 입력으로 업무를 만들면 되돌리기 토스트가 뜬다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    renderApp('/calendar/week/2026-10-07', routes)
    const panel = await screen.findByRole('complementary', { name: '할 일 상자' })
    await user.type(within(panel).getByLabelText('업무 빠른 입력'), '보고서 정리{Enter}')
    expect(await screen.findByText('업무를 만들었어요')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/worklog/tasks' && init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ title: '보고서 정리' })
    expect(within(panel).getByLabelText('업무 빠른 입력')).toHaveValue('')
  })
})

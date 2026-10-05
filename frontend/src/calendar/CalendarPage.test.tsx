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
    return problem(404, 'NOT_FOUND')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

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
})

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Occurrence } from '../calendar/api'
import type { Task } from '../tasks/api'
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

const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  status: 'TODO',
  priority: 'NORMAL',
  dueDate: null,
  progress: 0,
  completedAt: null,
  projectId: null,
  tagIds: [],
  hasSchedule: false,
  memo: null,
  carriedOverFromId: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
  ...extra,
})

function server(t: Task, occurrences: Occurrence[] = []) {
  return stubFetch({
    'GET /api/users/me': () => json(200, ME),
    [`GET /api/worklog/tasks/${t.id}`]: () => json(200, t),
    'GET /api/worklog/schedules': () => json(200, { items: occurrences }),
  })
}

describe('SCR-TASK-02 ⑤ 연결 일정 목록 (P1-05-06)', () => {
  it('다가오는 회차 5개까지(날짜·시간·반복), 넘으면 캘린더에서 더 보기, 업무로 거른 요청', async () => {
    // 10-08부터 하루씩 6개, 서울 10:00–11:00. 첫 회차만 반복
    const occurrences: Occurrence[] = Array.from({ length: 6 }, (_, i) => {
      const day = String(8 + i).padStart(2, '0')
      return {
        scheduleId: `s${i}`,
        occurrenceStart: `2026-10-${day}T01:00:00Z`,
        title: '견적서 작성',
        allDay: false,
        startAt: `2026-10-${day}T01:00:00Z`,
        endAt: `2026-10-${day}T02:00:00Z`,
        startDate: null,
        endDate: null,
        memo: null,
        projectId: null,
        taskId: 'today',
        recurring: i === 0,
        modified: false,
        version: 0,
      }
    })
    const fetchMock = server(task('today', '견적서 작성', { hasSchedule: true }), occurrences)
    renderApp('/tasks/today')
    const list = await screen.findByRole('list', { name: '연결된 일정' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(links[0]).toHaveTextContent('10/8(목)10:00 – 11:00반복')
    expect(links[0]).toHaveAttribute('href', '/calendar/day/2026-10-08')
    expect(screen.getByRole('link', { name: '일정 1개 더 · 캘린더에서 보기' })).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.startsWith('/api/worklog/schedules?') && u.includes('taskId=today'))).toBe(true)
  })

  it('일정이 없으면 받지 않고 안내하며, [캘린더에 배치]는 그 업무로 새 일정 창을 연다', async () => {
    const fetchMock = server(task('none', '팀 회고 정리'))
    const { router } = renderApp('/tasks/none')
    expect(await screen.findByText('아직 일정이 없어요')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/worklog/schedules'))).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: '캘린더에 배치' }))
    expect(router.state.location.pathname).toBe('/calendar/day/2026-10-07')
    const dialog = await screen.findByRole('dialog', { name: '새 일정' })
    expect(within(dialog).getByLabelText('제목')).toHaveValue('팀 회고 정리')
  })
})

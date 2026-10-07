import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkRecord } from '../records/api'
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

const task: Task = {
  id: 't1',
  title: '견적서 작성',
  status: 'IN_PROGRESS',
  priority: 'NORMAL',
  dueDate: null,
  progress: 40,
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
}

const record = (id: string, workDate: string, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  id,
  content: `기록 ${id}`,
  taskId: 't1',
  workDate,
  status: 'CONFIRMED',
  tagIds: [],
  createdAt: `${workDate}T00:00:00Z`,
  updatedAt: `${workDate}T00:00:00Z`,
  version: 0,
  ...extra,
})

function server(items: WorkRecord[], timeTracking = false) {
  return stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/me': () => json(200, { userId: 'u-1', settings: { timeTrackingEnabled: timeTracking } }),
    [`GET /api/worklog/tasks/${task.id}`]: () => json(200, task),
    'GET /api/worklog/records': () => json(200, { items }),
    ...Object.fromEntries(items.map((r) => [`GET /api/worklog/records/${r.id}`, () => json(200, r)])),
  })
}

describe('SCR-TASK-02 ⑥ 기록 이력 (P2)', () => {
  it('업무의 확정 기록을 최근 날짜부터 날짜·내용·결과·(옵션) 시간으로, 누르면 기록 수정 창, 닫으면 그 행으로', async () => {
    const fetchMock = server(
      [
        record('a', '2026-10-05', { content: '초안 작성', durationMin: 90 }),
        record('b', '2026-10-06', {
          content: '고객 피드백 반영',
          outcome: 'IN_PROGRESS',
          progress: 40,
          result: '단가표만 남음',
          startAt: '2026-10-06T01:00:00Z',
          endAt: '2026-10-06T02:30:00Z',
        }),
      ],
      true,
    )
    renderApp('/tasks/t1')
    const list = await screen.findByRole('list', { name: '기록 이력' })
    const rows = within(list).getAllByRole('button')
    expect(rows[0]).toHaveTextContent('10/6(화)고객 피드백 반영진행 중 40% — 단가표만 남음 · 10:00–11:30')
    expect(rows[1]).toHaveTextContent('10/5(월)초안 작성1시간 30분')
    const url = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/worklog/records?'))
    expect(url).toBe('/api/worklog/records?from=2025-10-02&to=2026-11-06&taskId=t1&status=CONFIRMED')

    rows[0].focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '기록 수정' })
    await waitFor(() => expect(within(dialog).getByLabelText('한 일')).toHaveValue('고객 피드백 반영'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(screen.getByRole('list', { name: '기록 이력' })).getAllByRole('button')[0]).toHaveFocus()
  })

  it('시간 기록 옵션이 꺼져 있으면 시간을 보이지 않는다', async () => {
    server([record('a', '2026-10-05', { content: '초안 작성', durationMin: 90, outcome: 'DONE' })])
    renderApp('/tasks/t1')
    const list = await screen.findByRole('list', { name: '기록 이력' })
    expect(within(list).getByRole('button')).toHaveTextContent(/^10\/5\(월\)초안 작성완료$/)
  })

  it('기록이 없으면 안내만', async () => {
    server([])
    renderApp('/tasks/t1')
    expect(await screen.findByText('아직 이 업무로 남긴 기록이 없어요')).toBeInTheDocument()
  })

  it('10개를 넘으면 더 보기, 누르면 나머지를 펼치고 새로 보인 첫 기록으로 포커스', async () => {
    const items = Array.from({ length: 12 }, (_, i) => record(`r${i}`, `2026-09-${String(10 + i).padStart(2, '0')}`))
    server(items)
    renderApp('/tasks/t1')
    const list = await screen.findByRole('list', { name: '기록 이력' })
    expect(within(list).getAllByRole('button')).toHaveLength(10)
    await userEvent.click(screen.getByRole('button', { name: '이전 기록 2개 더 보기' }))
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(12)
    expect(rows[10]).toHaveFocus()
    expect(rows[10]).toHaveTextContent('기록 r1')
  })
})

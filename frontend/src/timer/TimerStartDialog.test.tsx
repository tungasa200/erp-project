import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp } from '../test/renderApp'
import { TimerStartDialog } from './TimerStartDialog'

const task = {
  id: 'task-report',
  title: '9월 매출 보고서',
  status: 'TODO',
  priority: 'NORMAL',
  progress: 0,
  dueDate: null,
  projectId: null,
  tagIds: [],
  hasSchedule: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  version: 0,
}

function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/users/me') return json(200, ME)
      if (url.startsWith('/api/worklog/tasks?')) return json(200, { items: [task] })
      if (url === `/api/worklog/tasks/${task.id}`) return json(200, task)
      return problem(404, 'NOT_FOUND')
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('타이머 시작 창 (SCR-COM-06 ⑦)', () => {
  it('UX-COM-05 업무를 고르면 포커스가 문서 맨 위로 빠지지 않고 할 일 칸으로 간다. 두 칸의 관계는 처음부터 보인다', async () => {
    stubServer()
    const user = userEvent.setup()
    renderApp('/', [{ path: '/', element: <TimerStartDialog onClose={() => {}} /> }])
    const content = await screen.findByRole('textbox', { name: /할 일/ })
    expect(content).toHaveAccessibleName('할 일 (업무를 고르면 비워도 돼요)')

    await user.type(screen.getByRole('combobox', { name: '연결 업무' }), '보고')
    await screen.findByRole('option', { name: '9월 매출 보고서' })
    await user.keyboard('{Enter}')
    await screen.findByRole('link', { name: '9월 매출 보고서' })
    await waitFor(() => expect(content).toHaveFocus())
    expect(content).toHaveAccessibleName('할 일 (비우면 업무 제목)')
  })
})

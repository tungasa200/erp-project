import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, json, problem, renderApp } from '../test/renderApp'
import { TaskLinkField } from './TaskLinkField'

const task = (id: string, title: string) => ({
  id,
  title,
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
})
const tasks = [task('task-report', '9월 매출 보고서'), task('task-idea', '아이디어 정리')]

function stubServer() {
  const created = task('task-new', '새 할 일')
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/users/me') return json(200, ME)
    if (url === '/api/worklog/tasks' && init?.method === 'POST') return json(201, created)
    if (url.startsWith('/api/worklog/tasks?')) {
      const q = new URLSearchParams(url.split('?')[1]).get('q') ?? ''
      return json(200, { items: tasks.filter((t) => t.title.includes(q)) })
    }
    const detail = /^\/api\/worklog\/tasks\/([^/?]+)$/.exec(url)
    if (detail) {
      const found = [...tasks, created].find((t) => t.id === detail[1])
      return found ? json(200, found) : problem(404, 'NOT_FOUND')
    }
    return problem(404, 'NOT_FOUND')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function Harness({ recurring = false }: { recurring?: boolean }) {
  const [taskId, setTaskId] = useState<string | null>(null)
  return <TaskLinkField taskId={taskId} onChange={setTaskId} recurring={recurring} />
}

const render = (recurring?: boolean) => renderApp('/', [{ path: '/', element: <Harness recurring={recurring} /> }])

afterEach(() => vi.unstubAllGlobals())

describe('일정 상세 연결 업무 (P1-05-06)', () => {
  it('검색해 키보드로 고르면 업무 이름 링크와 [해제]가 보이고, 해제하면 검색으로 돌아간다', async () => {
    stubServer()
    const user = userEvent.setup()
    render()
    const box = await screen.findByRole('combobox', { name: '연결 업무' })
    await user.type(box, '보고')
    expect(await screen.findByRole('option', { name: '9월 매출 보고서' })).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Enter}')

    const linked = await screen.findByRole('link', { name: '9월 매출 보고서' })
    expect(linked).toHaveAttribute('href', '/tasks/task-report')
    await user.click(screen.getByRole('button', { name: '해제' }))
    // 사라진 [해제] 대신 검색 칸으로 포커스
    expect(await screen.findByRole('combobox', { name: '연결 업무' })).toHaveFocus()
  })

  it('맞는 업무가 없으면 안내하고, [새 업무]는 입력한 제목으로 업무를 만들어 연결한다', async () => {
    const fetchMock = stubServer()
    const user = userEvent.setup()
    render(true)
    expect(await screen.findByText('반복 일정은 모든 회차에 연결돼요')).toBeInTheDocument()
    const box = screen.getByRole('combobox', { name: '연결 업무' })
    expect(screen.getByRole('button', { name: '새 업무' })).toBeDisabled()
    await user.type(box, '새 할 일')
    expect(await screen.findByText(/맞는 업무가 없어요/)).toHaveAttribute('role', 'status')

    await user.click(screen.getByRole('button', { name: '새 업무' }))
    expect(await screen.findByRole('link', { name: '새 할 일' })).toHaveAttribute('href', '/tasks/task-new')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toEqual({ title: '새 할 일' })
  })

  it('Esc는 목록만 닫는다', async () => {
    stubServer()
    const user = userEvent.setup()
    render()
    const box = await screen.findByRole('combobox', { name: '연결 업무' })
    await user.type(box, '정리')
    await screen.findByRole('option', { name: '아이디어 정리' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'false'))
    expect(box).toHaveValue('정리')
  })
})

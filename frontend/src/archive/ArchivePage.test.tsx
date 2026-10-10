import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from '../test/renderApp'
import type { Task } from '../tasks/api'
import { ArchivePage } from './ArchivePage'

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  color: 'P1',
  archived: false,
  archivedAt: null,
  taskCount: 2,
  openTaskCount: 1,
  createdAt: '2026-09-01T00:00:00Z',
  version: 3,
  ...extra,
})

const task = (id: string, title: string, deletedAt: string, extra: Partial<Task> = {}): Task => ({
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
  deletedAt,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  version: 0,
  ...extra,
})

function setup(options: { tasks?: Task[]; projects?: ReturnType<typeof project>[]; conflict?: boolean } = {}) {
  let tasks = options.tasks ?? [
    task('t-old', '사내 세미나 자료', '2026-09-28T00:12:00Z'),
    task('t-new', '구 결제 모듈 정리', '2026-10-06T08:40:00Z', { projectId: 'p-dev' }),
  ]
  let projects = options.projects ?? [
    project('p-dev', '개발'),
    project('p-old', '레거시', { archived: true, archivedAt: '2026-10-02T02:05:00Z' }),
  ]
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: projects }),
    'GET /api/worklog/tasks': () => json(200, { items: tasks, nextCursor: null }),
    'POST /api/worklog/tasks/t-new/restore': () => {
      tasks = tasks.filter((t) => t.id !== 't-new')
      return json(200, task('t-new', '구 결제 모듈 정리', ''))
    },
    'DELETE /api/worklog/tasks/t-new': () => new Response(null, { status: 204 }),
    'PATCH /api/worklog/projects/p-old': () => {
      if (options.conflict) return problem(409, 'VERSION_CONFLICT')
      projects = projects.map((p) => (p.id === 'p-old' ? { ...p, archived: false, archivedAt: null } : p))
      return json(200, projects[1])
    },
  })
  const result = renderApp('/tasks/archive', [{ path: '/tasks/archive', element: <ArchivePage /> }])
  return { fetchMock, ...result }
}

describe('SCR-TASK-04 보관함', () => {
  it('보관한 업무를 보관 시각 역순으로, 보관 시각은 사용자 시간대로', async () => {
    const { fetchMock } = setup()
    const panel = await screen.findByRole('tabpanel', { name: '업무 2' })
    const items = within(panel).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('구 결제 모듈 정리개발10/6 화 17:40 보관복원')
    expect(items[1]).toHaveTextContent('사내 세미나 자료9/28 월 09:12 보관')
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/worklog/tasks?deleted=true&sort=created')).toBe(true)
  })

  it('업무 복원: 목록에서 빠지고 제목을 넣어 알린다, 되돌리기는 다시 보관', async () => {
    const { fetchMock } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '구 결제 모듈 정리 복원' }))
    await waitFor(() => expect(screen.queryByText('구 결제 모듈 정리')).not.toBeInTheDocument())
    expect(screen.getByText("'구 결제 모듈 정리'를 복원했어요")).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([u, init]) => u === '/api/worklog/tasks/t-new/restore' && init?.method === 'POST'),
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, init]) => u === '/api/worklog/tasks/t-new' && init?.method === 'DELETE'),
      ).toBe(true),
    )
  })

  it('프로젝트 탭: 화살표로 옮기고, 복원은 archived=false와 version을 보낸다', async () => {
    const { fetchMock, router } = setup()
    const tasksTab = await screen.findByRole('tab', { name: '업무 2' })
    tasksTab.focus()
    await userEvent.keyboard('{ArrowRight}')
    const projectsTab = screen.getByRole('tab', { name: '프로젝트 1' })
    expect(projectsTab).toHaveFocus()
    expect(projectsTab).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.search).toBe('?type=projects')

    const panel = screen.getByRole('tabpanel', { name: '프로젝트 1' })
    expect(within(panel).getByRole('listitem')).toHaveTextContent('레거시업무 2개10/2 금 11:05 보관복원')
    await userEvent.click(within(panel).getByRole('button', { name: '레거시 복원' }))
    await waitFor(() => expect(screen.getByText('보관한 프로젝트가 없어요')).toBeInTheDocument())
    expect(screen.getByText("'레거시'를 복원했어요")).toBeInTheDocument()
    // 마지막 줄을 복원해도 탭은 남는다
    expect(screen.getByRole('tab', { name: '프로젝트 0' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: '프로젝트·태그 설정으로 가기' })).toHaveAttribute(
      'href',
      '/settings/projects',
    )
    const patch = fetchMock.mock.calls.find(
      ([u, init]) => u === '/api/worklog/projects/p-old' && init?.method === 'PATCH',
    )
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ version: 3, archived: false })
  })

  it('아무것도 없어도 탭은 두고 탭마다 빈 상태', async () => {
    setup({ tasks: [], projects: [project('p-dev', '개발')] })
    expect(await screen.findByText('보관한 업무가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '업무 0' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: '업무로 가기' })).toHaveAttribute('href', '/tasks')
    await userEvent.click(screen.getByRole('tab', { name: '프로젝트 0' }))
    expect(screen.getByText('보관한 프로젝트가 없어요')).toBeInTheDocument()
  })

  it('프로젝트 복원이 어긋나면(409) 알리고 목록을 다시 받는다', async () => {
    const { fetchMock } = setup({ conflict: true })
    await userEvent.click(await screen.findByRole('tab', { name: '프로젝트 1' }))
    const before = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/worklog/projects')).length
    await userEvent.click(screen.getByRole('button', { name: '레거시 복원' }))
    expect(await screen.findByText('요청을 처리하지 못했어요. 다시 시도해 주세요')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/worklog/projects?')).length,
      ).toBeGreaterThan(before),
    )
    expect(screen.getByRole('button', { name: '레거시 복원' })).toBeEnabled()
  })
})

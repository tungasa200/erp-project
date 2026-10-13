import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusRescue } from '../components/focusRescue'
import { json, ME, problem, renderApp, stubFetch } from '../test/renderApp'
import type { Task } from '../tasks/api'
import { ArchivePage } from './ArchivePage'

// 앱 셸의 포커스 안전망(AppShell의 useFocusRescue)과 같은 자리에서 보관함을 띄운다
function Shell() {
  const ref = useRef<HTMLDivElement>(null)
  useFocusRescue(ref)
  return (
    <div ref={ref}>
      <ArchivePage />
    </div>
  )
}

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

function setup(
  options: { tasks?: Task[]; projects?: ReturnType<typeof project>[]; conflict?: boolean; purgeStatus?: number } = {},
) {
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
    'DELETE /api/worklog/tasks/t-new/permanent': () => {
      if (options.purgeStatus)
        return problem(options.purgeStatus, options.purgeStatus === 409 ? 'TASK_NOT_ARCHIVED' : 'NOT_FOUND')
      tasks = tasks.filter((t) => t.id !== 't-new')
      return new Response(null, { status: 204 })
    },
    'DELETE /api/worklog/projects/p-old/permanent': () => {
      projects = projects.filter((p) => p.id !== 'p-old')
      return new Response(null, { status: 204 })
    },
    'PATCH /api/worklog/projects/p-old': () => {
      if (options.conflict) return problem(409, 'VERSION_CONFLICT')
      projects = projects.map((p) => (p.id === 'p-old' ? { ...p, archived: false, archivedAt: null } : p))
      return json(200, projects[1])
    },
  })
  const result = renderApp('/tasks/archive', [{ path: '/tasks/archive', element: <Shell /> }])
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
    expect(screen.getByRole('link', { name: '보기' })).toHaveAttribute('href', '/tasks/t-new')
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
    // 업무에는 ⋯ 메뉴가 없다: 상세 패널의 [보관]으로 안내한다
    expect(screen.getByText(/업무를 열어 \[보관\]을 누르세요/)).toBeInTheDocument()
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

  it('업무 영구 삭제: 확인 창([취소]가 먼저) → DELETE …/permanent, 되돌리기 없이 알리고 포커스는 다음 줄로', async () => {
    const { fetchMock } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '구 결제 모듈 정리 영구 삭제' }))
    const dialog = screen.getByRole('alertdialog', { name: "'구 결제 모듈 정리'를 영구 삭제할까요?" })
    expect(dialog).toHaveTextContent('삭제하면 되돌릴 수 없어요. 이 업무로 남긴 기록과 일정은 그대로 남고')
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: '영구 삭제' }))
    expect(await screen.findByText("'구 결제 모듈 정리'를 영구 삭제했어요")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('구 결제 모듈 정리')).not.toBeInTheDocument())
    expect(
      fetchMock.mock.calls.some(([u, init]) => u === '/api/worklog/tasks/t-new/permanent' && init?.method === 'DELETE'),
    ).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '사내 세미나 자료 영구 삭제' })).toHaveFocus())
  })

  it('영구 삭제 취소: 보내지 않고 누른 버튼으로 돌아간다', async () => {
    const { fetchMock } = setup()
    const button = await screen.findByRole('button', { name: '사내 세미나 자료 영구 삭제' })
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/permanent'))).toBe(false)
  })

  it.each([
    [404, '이미 삭제된 항목이에요'],
    [409, '보관함에 있는 항목만 삭제할 수 있어요'],
  ])('영구 삭제 %i: 알리고 목록을 다시 받는다', async (status, message) => {
    const { fetchMock } = setup({ purgeStatus: status })
    await userEvent.click(await screen.findByRole('button', { name: '구 결제 모듈 정리 영구 삭제' }))
    const before = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/worklog/tasks?')).length
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '영구 삭제' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/worklog/tasks?')).length).toBeGreaterThan(
        before,
      ),
    )
  })

  it('프로젝트 영구 삭제: 옮겨질 업무 수(보관한 소속 업무 포함)를 알리고, 마지막 줄이면 포커스는 빈 상태 제목', async () => {
    setup({ tasks: [task('t-old', 'QA삭제P', '2026-09-28T00:12:00Z', { projectId: 'p-old' })] })
    await userEvent.click(await screen.findByRole('tab', { name: '프로젝트 1' }))
    await userEvent.click(screen.getByRole('button', { name: '레거시 영구 삭제' }))
    const dialog = screen.getByRole('alertdialog', { name: "'레거시'를 영구 삭제할까요?" })
    // 보관하지 않은 업무 2개(taskCount) + 보관한 소속 업무 1개
    expect(dialog).toHaveAccessibleDescription(
      "삭제하면 되돌릴 수 없어요. 이 프로젝트의 업무 3개는 지워지지 않고 '프로젝트 없음'으로 옮겨져요.",
    )
    await userEvent.click(within(dialog).getByRole('button', { name: '영구 삭제' }))
    expect(await screen.findByText("'레거시'를 영구 삭제했어요")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('보관한 프로젝트가 없어요')).toHaveFocus())
  })

  it('보관한 업무를 다 받지 못했으면 확인 창에 개수를 쓰지 않는다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/projects': () =>
        json(200, { items: [project('p-old', '레거시', { archived: true, archivedAt: '2026-10-02T02:05:00Z' })] }),
      'GET /api/worklog/tasks': () =>
        json(200, { items: [task('t-1', '첫 장', '2026-10-01T00:00:00Z')], nextCursor: 'more' }),
    })
    renderApp('/tasks/archive?type=projects', [{ path: '/tasks/archive', element: <Shell /> }])
    await userEvent.click(await screen.findByRole('button', { name: '레거시 영구 삭제' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      "이 프로젝트의 업무는 지워지지 않고 '프로젝트 없음'으로 옮겨져요.",
    )
  })

  it.each([
    ['QA삭제P', '를'],
    ['버전 3', '을'],
    ['Plan', '을'],
    ['회의(정기)', '를'],
    ['결제 모듈', '을'],
  ])("이름이 '%s'이면 조사는 '%s'", async (title, josa) => {
    setup({ tasks: [task('t-new', title, '2026-10-06T08:40:00Z')] })
    await userEvent.click(await screen.findByRole('button', { name: `${title} 영구 삭제` }))
    expect(screen.getByRole('alertdialog', { name: `'${title}'${josa} 영구 삭제할까요?` })).toBeInTheDocument()
  })
})

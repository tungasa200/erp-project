import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../tasks/api'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

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

const PROJECTS = [
  {
    id: 'p-sales',
    name: '영업',
    color: 'P2',
    archived: false,
    taskCount: 2,
    createdAt: '2026-10-01T00:00:00Z',
    version: 0,
  },
]
const TAGS = [{ id: 't-quote', name: '견적', usageCount: 1, createdAt: '2026-10-01T00:00:00Z', version: 0 }]

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

function server(initial: Task[], options: { conflictOn?: string } = {}) {
  let tasks = initial.map((t) => ({ ...t }))
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = []
  const handlers: Parameters<typeof stubFetch>[0] = {
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects': () => json(200, { items: PROJECTS }),
    'GET /api/worklog/tags': () => json(200, { items: TAGS }),
    'GET /api/worklog/tasks': () => json(200, { items: [], nextCursor: null }),
  }
  const fetchMock = stubFetch(handlers)
  // 업무 경로는 동적이라 fetch를 한 번 더 감싼다
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    const path = url.split('?')[0]
    if (path.startsWith('/api/worklog/tasks')) {
      calls.push({ method, url, body })
      if (method === 'GET' && path === '/api/worklog/tasks') {
        const q = new URLSearchParams(url.split('?')[1])
        const statuses = q.getAll('status')
        const items = tasks.filter(
          (t) =>
            !t.deletedAt &&
            (statuses.length === 0 || statuses.includes(t.status)) &&
            (!q.getAll('projectId').length || q.getAll('projectId').includes(t.projectId ?? '')),
        )
        return json(200, { items, nextCursor: null })
      }
      if (method === 'POST' && path === '/api/worklog/tasks') {
        const created = task('new', String(body?.title), body as Partial<Task>)
        tasks.push(created)
        return json(201, created)
      }
      const m = /^\/api\/worklog\/tasks\/([^/]+)(\/restore)?$/.exec(path)!
      const current = tasks.find((t) => t.id === m[1])!
      if (m[2]) {
        current.deletedAt = null
        return json(200, current)
      }
      if (method === 'GET') return json(200, current)
      if (method === 'DELETE') {
        current.deletedAt = '2026-10-07T03:00:00Z'
        return new Response(null, { status: 204 })
      }
      if (method === 'PATCH') {
        if (options.conflictOn === current.id || body?.version !== current.version)
          return problem(409, 'VERSION_CONFLICT')
        const { version: _, ...fields } = body!
        tasks = tasks.map((t) => (t.id === current.id ? { ...t, ...fields, version: t.version + 1 } : t))
        return json(
          200,
          tasks.find((t) => t.id === current.id),
        )
      }
    }
    return base(input, init)
  })
  return { calls, tasks: () => tasks }
}

const SAMPLE = [
  task('late', '9월 매출 보고서', { dueDate: '2026-10-06', priority: 'HIGH', projectId: 'p-sales' }),
  task('today', '견적서 작성', { dueDate: '2026-10-07', projectId: 'p-sales', tagIds: ['t-quote'], hasSchedule: true }),
  task('later', '결제 API 문서화', { dueDate: '2026-10-20' }),
  task('none', '팀 회고 정리'),
]

describe('SCR-TASK-01 업무 목록', () => {
  it('마감 상태로 묶어 보여 주고, 마감 초과는 빨간 묶음이다', async () => {
    server(SAMPLE)
    renderApp('/tasks')
    expect(await screen.findByRole('heading', { name: '마감 초과 · 1' })).toHaveClass('danger')
    expect(screen.getByRole('heading', { name: '오늘 · 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '다음 · 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '날짜 없음 · 1' })).toBeInTheDocument()
    const today = within(screen.getByRole('list', { name: '오늘 · 1' }))
    expect(today.getByText('영업')).toBeInTheDocument()
    expect(today.getByText('#견적')).toBeInTheDocument()
    expect(today.getByLabelText('일정에 배치됨')).toBeInTheDocument()
  })

  it('필터는 URL에 남고 API 조건으로 보낸다 (사이드바 프로젝트 → /tasks?project=)', async () => {
    const { calls } = server(SAMPLE)
    const { router } = renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: /영업/ }))
    expect(router.state.location.pathname).toBe('/tasks')
    expect(router.state.location.search).toBe('?project=p-sales')
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'GET' && c.url.includes('projectId=p-sales&') && c.url.includes('status=TODO')),
      ).toBe(true),
    )
    expect(await screen.findByRole('button', { name: '프로젝트: 영업' })).toBeInTheDocument()
    // 사이드바 프로젝트는 현재 페이지(aria-current)로 읽히지 않는다 — 업무 메뉴만 현재 페이지다
    expect(screen.getByRole('link', { name: '영업, 업무 2개' })).not.toHaveAttribute('aria-current')
  })

  it('완료 체크는 바로 완료하고 되돌리기로 원래 상태로 돌린다', async () => {
    const { calls } = server(SAMPLE)
    renderApp('/tasks')
    await userEvent.click(await screen.findByRole('checkbox', { name: '팀 회고 정리 완료' }))
    expect(await screen.findByText('업무 1개를 완료했어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { version: 0, status: 'DONE' },
        { version: 1, status: 'TODO' },
      ]),
    )
  })

  it('행에서 Delete를 누르면 보관하고, 되돌리면 복원한다', async () => {
    const { calls } = server(SAMPLE)
    renderApp('/tasks')
    const title = await screen.findByRole('link', { name: '결제 API 문서화' })
    title.focus()
    fireEvent.keyDown(title, { key: 'Delete' })
    expect(await screen.findByText('업무 1개를 보관했어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`)).toEqual([
        'DELETE /api/worklog/tasks/later',
        'POST /api/worklog/tasks/later/restore',
      ]),
    )
  })

  it('업무가 하나도 없으면 문법 안내, 필터 결과가 없으면 필터 지우기', async () => {
    server([])
    const { router } = renderApp('/tasks?due=overdue')
    expect(await screen.findByText('조건에 맞는 업무가 없어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '필터 지우기' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('아직 업무가 없어요')).toBeInTheDocument()
  })

  it('상태를 모두 끄면 빈 목록 대신 상태를 고르라고 알리고, 기본 상태로 되돌린다', async () => {
    server([task('a', '견적서 회신')])
    const { router } = renderApp('/tasks?status=')
    expect(await screen.findByText('상태를 하나 이상 골라 주세요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '기본 상태로' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('견적서 회신')).toBeInTheDocument()
  })

  it('빠른 입력 Enter로 업무를 만들고 되돌리기 토스트를 띄운다', async () => {
    const { calls } = server([])
    renderApp('/tasks')
    const input = await screen.findByRole('textbox', { name: '업무 추가' })
    await userEvent.type(input, '견적서 회신 @영업 !높음{Enter}')
    expect(await screen.findByText('업무 1개를 추가했어요')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      title: '견적서 회신',
      priority: 'HIGH',
      projectId: 'p-sales',
    })
  })

  it('없는 @프로젝트로는 저장하지 않고 입력을 남긴다', async () => {
    const { calls } = server([])
    renderApp('/')
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    await userEvent.type(input, '보도자료 @마케팅{Enter}')
    expect(await screen.findByText('"마케팅" 프로젝트가 없어요. 아래 칩을 눌러 먼저 만들어 주세요')).toBeInTheDocument()
    expect(input).toHaveValue('보도자료 @마케팅')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('SCR-TASK-02 업무 상세', () => {
  it('행을 누르면 상세 패널이 열리고 항목마다 자동 저장한다', async () => {
    const { calls } = server(SAMPLE)
    const { router } = renderApp('/tasks')
    await userEvent.click(await screen.findByRole('link', { name: '견적서 작성' }))
    expect(router.state.location.pathname).toBe('/tasks/today')
    const status = await screen.findByRole('combobox', { name: '상태' })
    await userEvent.selectOptions(status, 'IN_PROGRESS')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '우선순위' }), 'HIGH')
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { version: 0, status: 'IN_PROGRESS' },
        { version: 1, priority: 'HIGH' },
      ]),
    )
  })

  it('제목을 비우면 저장하지 않고 원래 제목으로 돌린다', async () => {
    const { calls } = server(SAMPLE)
    renderApp('/tasks/none')
    const title = await screen.findByRole('textbox', { name: '제목' })
    await userEvent.clear(title)
    await userEvent.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('제목을 적어 주세요')
    expect(title).toHaveValue('팀 회고 정리')
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('다른 곳에서 먼저 고쳤으면(409) 충돌 띠를 보여 준다', async () => {
    server(SAMPLE, { conflictOn: 'none' })
    renderApp('/tasks/none')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '상태' }), 'ON_HOLD')
    expect(await screen.findByText('다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새로 불러오기' })).toBeInTheDocument()
  })

  it('보관하면 패널을 닫고 목록으로 돌아간다', async () => {
    server(SAMPLE)
    const { router } = renderApp('/tasks/none')
    await userEvent.click(await screen.findByRole('button', { name: '보관' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
    expect(await screen.findByText('업무 1개를 보관했어요')).toBeInTheDocument()
  })
})

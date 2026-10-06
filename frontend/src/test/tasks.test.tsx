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
    openTaskCount: 1,
    createdAt: '2026-10-01T00:00:00Z',
    version: 0,
  },
]
const TAGS = [
  { id: 't-quote', name: '견적', usageCount: 1, createdAt: '2026-10-01T00:00:00Z', version: 0 },
  { id: 't-pay', name: '결제', usageCount: 0, createdAt: '2026-10-01T00:00:00Z', version: 0 },
]

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

function server(initial: Task[], options: { conflictOn?: string; rejectWith?: string } = {}) {
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
            (!q.getAll('projectId').length || q.getAll('projectId').includes(t.projectId ?? '')) &&
            // 계약: completedSince는 완료 업무만 거른다
            (!q.get('completedSince') || t.status !== 'DONE' || (t.completedAt ?? '') >= q.get('completedSince')!),
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
        if (options.rejectWith) return problem(409, options.rejectWith)
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
    await userEvent.click(await screen.findByRole('link', { name: '영업, 남은 업무 1개' }))
    expect(router.state.location.pathname).toBe('/tasks')
    expect(router.state.location.search).toBe('?project=p-sales')
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'GET' && c.url.includes('projectId=p-sales&') && c.url.includes('status=TODO')),
      ).toBe(true),
    )
    expect(await screen.findByRole('button', { name: '프로젝트: 영업' })).toBeInTheDocument()
    // 사이드바 프로젝트는 현재 페이지(aria-current)로 읽히지 않는다 — 업무 메뉴만 현재 페이지다
    expect(screen.getByRole('link', { name: '영업, 남은 업무 1개' })).not.toHaveAttribute('aria-current')
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

  it('완료·보관으로 행이 빠지면 포커스를 이웃 행의 완료 체크로, 마지막이면 목록 제목으로 옮긴다', async () => {
    server(SAMPLE)
    renderApp('/tasks')
    // 키보드로 완료 → 다음 행(결제 API 문서화)
    ;(await screen.findByRole('checkbox', { name: '견적서 작성 완료' })).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('link', { name: '견적서 작성' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '결제 API 문서화 완료' })).toHaveFocus())

    // Delete로 보관 → 다음 행(팀 회고 정리)
    fireEvent.keyDown(screen.getByRole('link', { name: '결제 API 문서화' }), { key: 'Delete' })
    await waitFor(() => expect(screen.queryByRole('link', { name: '결제 API 문서화' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '팀 회고 정리 완료' })).toHaveFocus())
  })

  it('남은 행이 없으면 포커스를 목록 제목(h1)으로 옮긴다', async () => {
    server([task('only', '혼자 남은 업무')])
    renderApp('/tasks')
    ;(await screen.findByRole('checkbox', { name: '혼자 남은 업무 완료' })).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('link', { name: '혼자 남은 업무' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('업무가 하나도 없으면 문법 안내, 필터 결과가 없으면 필터 지우기', async () => {
    server([])
    const { router } = renderApp('/tasks?due=overdue')
    expect(await screen.findByText('조건에 맞는 업무가 없어요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '필터 지우기' }))
    expect(router.state.location.search).toBe('')
    // P1-04-04 버튼이 사라져도 포커스는 목록 제목으로
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(await screen.findByText('아직 업무가 없어요')).toBeInTheDocument()
  })

  it('P1-11-02 상태에 완료가 있으면 완료 업무를 본문에 보이고, 홈 카드의 이번 주 조건으로 개수를 맞춘다', async () => {
    const { calls } = server([
      task('d-this', '이번 주에 끝낸 일', { status: 'DONE', completedAt: '2026-10-06T01:00:00Z' }),
      task('d-last', '지난주에 끝낸 일', { status: 'DONE', completedAt: '2026-10-02T01:00:00Z' }),
      task('todo', '아직 할 일'),
    ])
    const { router } = renderApp('/tasks?status=DONE&completed=week')
    expect(await screen.findByRole('link', { name: '이번 주에 끝낸 일' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '지난주에 끝낸 일' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '아직 할 일' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('업무 1')
    expect(screen.queryByText('상태를 하나 이상 골라 주세요')).not.toBeInTheDocument()
    // 완료를 골랐으면 아래 '완료 n개 (최근 7일)' 접힌 묶음은 없다
    expect(screen.queryByRole('button', { name: /최근 7일/ })).not.toBeInTheDocument()
    // 이번 주 첫날(월 10-05) 서울 0시부터
    expect(calls.some((c) => c.url.includes('completedSince=2026-10-04T15%3A00%3A00.000Z'))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: '완료 기간 조건 지우기: 이번 주부터' }))
    expect(router.state.location.search).toBe('?status=DONE')
    expect(await screen.findByRole('link', { name: '지난주에 끝낸 일' })).toBeInTheDocument()
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
  it('P1-03-07 태그 ×를 누르면 다음 태그의 ×로, 다 빼면 태그 추가 칸으로 포커스가 간다', async () => {
    server([task('two', '태그 둘', { tagIds: ['t-quote', 't-pay'] })])
    renderApp('/tasks/two')
    ;(await screen.findByRole('button', { name: '견적 태그 빼기' })).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: '결제 태그 빼기' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: '태그 추가' })).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

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

  it('P1-03-13 Esc·닫기(×)로 닫으면 패널을 연 행의 제목 링크로 포커스가 돌아온다', async () => {
    server(SAMPLE)
    renderApp('/tasks')
    const link = await screen.findByRole('link', { name: '견적서 작성' })
    link.focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('combobox', { name: '상태' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('link', { name: '견적서 작성' })).toHaveFocus())

    await userEvent.click(screen.getByRole('link', { name: '견적서 작성' }))
    await userEvent.click(await screen.findByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.getByRole('link', { name: '견적서 작성' })).toHaveFocus())
  })

  it('진행률 슬라이더에 포커스가 있어도 Esc로 닫히고, 제목 칸에서는 닫히지 않는다', async () => {
    server(SAMPLE)
    const { router } = renderApp('/tasks/today')
    ;(await screen.findByRole('textbox', { name: '제목' })).focus()
    await userEvent.keyboard('{Escape}')
    expect(router.state.location.pathname).toBe('/tasks/today')

    screen.getByRole('slider').focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
  })

  it('패널에서 보관하면 행이 빠진 뒤 이웃 행의 완료 체크로 포커스가 간다', async () => {
    server(SAMPLE)
    renderApp('/tasks/later')
    await userEvent.click(await screen.findByRole('button', { name: '보관' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: '결제 API 문서화' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '팀 회고 정리 완료' })).toHaveFocus())
  })

  it('P1-03-09 보관한 업무는 마감일도 막고, 복원하면 제목 칸으로 포커스를 옮긴다', async () => {
    server([task('arch', '보관한 업무', { deletedAt: '2026-10-07T00:00:00Z', dueDate: '2026-10-05' })])
    renderApp('/tasks/arch')
    expect(await screen.findByLabelText('마감일')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '복원' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '제목' })).toHaveFocus())
  })

  it('마감일을 키보드로 치면 중간값은 저장하지 않고 blur·Enter에서 한 번 저장하며, 말이 안 되는 날짜는 되돌린다', async () => {
    const { calls } = server(SAMPLE)
    renderApp('/tasks/today')
    const due = await screen.findByLabelText('마감일')
    const patches = () => calls.filter((c) => c.method === 'PATCH').map((c) => c.body)

    // 연도를 치는 중의 중간값(1013-06-06) → 저장하지 않고, 그대로 떠나면 서버 값으로
    fireEvent.keyDown(due, { key: '1' })
    fireEvent.change(due, { target: { value: '1013-06-06' } })
    expect(patches()).toEqual([])
    fireEvent.focusOut(due)
    expect(due).toHaveValue('2026-10-07')
    expect(patches()).toEqual([])

    // 다 치고 Enter → 한 번만 저장(이어지는 blur는 다시 보내지 않음)
    fireEvent.keyDown(due, { key: '2' })
    fireEvent.change(due, { target: { value: '2026-10-20' } })
    fireEvent.keyDown(due, { key: 'Enter' })
    fireEvent.focusOut(due)
    await waitFor(() => expect(patches()).toEqual([{ version: 0, dueDate: '2026-10-20' }]))
  })

  it('달력에서 고르면(키 입력 없이 바뀜) 바로 저장한다', async () => {
    const { calls } = server(SAMPLE)
    renderApp('/tasks/today')
    fireEvent.change(await screen.findByLabelText('마감일'), { target: { value: '2026-10-21' } })
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { version: 0, dueDate: '2026-10-21' },
      ]),
    )
  })

  it('P1-03-09 저장이 거부되면 바꾼 칸을 서버 값으로 되돌린다', async () => {
    server(SAMPLE, { rejectWith: 'TASK_DELETED' })
    renderApp('/tasks/today')
    const due = await screen.findByLabelText('마감일')
    fireEvent.change(due, { target: { value: '2026-10-20' } })
    expect(await screen.findByText('보관한 업무라 바꿀 수 없어요')).toBeInTheDocument()
    expect(due).toHaveValue('2026-10-07')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'ON_HOLD')
    await waitFor(() => expect(screen.getByRole('combobox', { name: '상태' })).toHaveValue('TODO'))
  })

  it('되돌리기 토스트 버튼을 누르면 토스트를 띄운 곳(없어졌으면 화면 제목)으로 포커스가 간다', async () => {
    server(SAMPLE)
    renderApp('/tasks')
    ;(await screen.findByRole('checkbox', { name: '팀 회고 정리 완료' })).focus()
    await userEvent.keyboard('{Enter}')
    const undo = await screen.findByRole('button', { name: '되돌리기' })
    undo.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.closest('[role="status"]')).toBeNull()
  })

  it('보관하면 패널을 닫고 목록으로 돌아간다', async () => {
    server(SAMPLE)
    const { router } = renderApp('/tasks/none')
    await userEvent.click(await screen.findByRole('button', { name: '보관' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'))
    expect(await screen.findByText('업무 1개를 보관했어요')).toBeInTheDocument()
  })
})

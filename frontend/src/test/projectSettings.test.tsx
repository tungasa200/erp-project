import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import type { Project, Tag } from '../projects/api'
import { ProjectSettings } from '../settings/ProjectSettings'
import { json, problem, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const project = (id: string, name: string, color: Project['color'], extra: Partial<Project> = {}): Project => ({
  id,
  name,
  color,
  archived: false,
  archivedAt: null,
  taskCount: 2,
  openTaskCount: 2,
  createdAt: '2026-10-01T00:00:00Z',
  version: 0,
  ...extra,
})
const tag = (id: string, name: string, usageCount: number): Tag => ({
  id,
  name,
  usageCount,
  createdAt: '2026-10-01T00:00:00Z',
  version: 0,
})

function setup(options: { createProblem?: string } = {}) {
  const projects = [
    project('p1', '개발', 'P1'),
    project('p2', '영업', 'P2'),
    project('p3', '공통', 'P3'),
    project('p9', '옛일', 'P4', { archived: true }),
  ]
  const tags = [tag('t1', '결제', 4), tag('t2', '견적', 3)]
  const calls: { method: string; url: string; body?: unknown }[] = []
  const keepalives: boolean[] = []
  const record = (method: string, url: string, init?: RequestInit) =>
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })

  stubFetch({
    'GET /api/worklog/projects?includeArchived=true': () => json(200, { items: projects }),
    'POST /api/worklog/projects': (init) => {
      record('POST', '/api/worklog/projects', init)
      if (options.createProblem) return problem(409, options.createProblem)
      const body = JSON.parse(String(init?.body)) as { name: string; color: Project['color'] }
      return json(201, project('new', body.name, body.color, { taskCount: 0 }))
    },
    'PATCH /api/worklog/projects/p1': (init) => {
      record('PATCH', '/api/worklog/projects/p1', init)
      const body = JSON.parse(String(init?.body)) as { version: number; archived: boolean }
      return json(200, project('p1', '개발', 'P1', { archived: body.archived, version: body.version + 1 }))
    },
    'GET /api/worklog/tags': () => json(200, { items: tags }),
    'PATCH /api/worklog/tags/t1': (init) => {
      record('PATCH', '/api/worklog/tags/t1', init)
      const body = JSON.parse(String(init?.body)) as { name: string }
      if (body.name === '견적') return problem(409, 'DUPLICATE_NAME')
      return json(200, { ...tag('t1', body.name, 4), version: 1 })
    },
    'DELETE /api/worklog/tags/t2': (init) => {
      keepalives.push(init?.keepalive ?? false)
      record('DELETE', '/api/worklog/tags/t2')
      return new Response(null, { status: 204 })
    },
  })

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <ProjectSettings />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { calls, keepalives }
}

describe('SCR-SET-08 프로젝트', () => {
  it('보관하지 않은 프로젝트를 색·이름·업무 수와 함께 보여 주고 보관한 수를 알린다', async () => {
    setup()
    const list = await screen.findByRole('list', { name: '프로젝트 목록' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['개발업무 2보관', '영업업무 2보관', '공통업무 2보관'])
    expect(screen.getByText('보관한 프로젝트 1')).toBeInTheDocument()
  })

  it('보관하면 목록에서 빠지고 되돌리기로 보관을 푼다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '개발 보관' }))
    expect(await screen.findByText('프로젝트 1개를 보관했어요')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '프로젝트 목록' })).queryByText('개발')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '프로젝트 목록' })).getByText('개발')).toBeInTheDocument(),
    )
    expect(calls.map((c) => c.body)).toEqual([
      { version: 0, archived: true },
      { version: 1, archived: false },
    ])
  })

  it('새 프로젝트는 아직 안 쓴 첫 색(보관한 프로젝트 색 제외)을 기본으로 고른다', async () => {
    const { calls } = setup()
    await screen.findByRole('list', { name: '프로젝트 목록' })
    const colors = screen.getByRole('radiogroup', { name: '프로젝트 색' })
    // P1~P3은 쓰는 중, P4는 보관한 프로젝트만 써서 다시 쓸 수 있다
    expect(within(colors).getByRole('radio', { name: '보라' })).toHaveAttribute('aria-checked', 'true')

    await userEvent.type(screen.getByRole('textbox', { name: '새 프로젝트' }), ' 마케팅 ')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() =>
      expect(calls).toEqual([{ method: 'POST', url: '/api/worklog/projects', body: { name: '마케팅', color: 'P4' } }]),
    )
    expect(within(screen.getByRole('list', { name: '프로젝트 목록' })).getByText('마케팅')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '새 프로젝트' })).toHaveValue('')
  })

  it('이름이 비었거나 같은 이름이 있으면 칸 아래에 알린다', async () => {
    setup({ createProblem: 'DUPLICATE_NAME' })
    await screen.findByRole('list', { name: '프로젝트 목록' })
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(screen.getByRole('alert')).toHaveTextContent('프로젝트 이름을 적어 주세요')

    await userEvent.type(screen.getByRole('textbox', { name: '새 프로젝트' }), '개발')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByText('같은 이름의 프로젝트가 있어요')).toBeInTheDocument()
  })
})

describe('SCR-SET-08 프로젝트 보관 포커스', () => {
  it('보관하면 이웃 프로젝트의 [보관]으로 포커스가 간다', async () => {
    setup()
    ;(await screen.findByRole('button', { name: '개발 보관' })).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('button', { name: '개발 보관' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '영업 보관' })).toHaveFocus()
  })
})

describe('SCR-SET-08 태그', () => {
  it('이름을 바꾸고, 같은 이름이면 알린다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '결제 태그 이름 바꾸기' }))
    const input = screen.getByRole('textbox', { name: '태그 이름' })
    await userEvent.clear(input)
    await userEvent.type(input, '견적{Enter}')
    expect(await screen.findByText('같은 이름의 태그가 있어요')).toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, '정산{Enter}')
    expect(await screen.findByText('#정산')).toBeInTheDocument()
    expect(calls.at(-1)?.body).toEqual({ version: 0, name: '정산' })
  })

  it('공백이나 #이 든 이름은 보내지 않는다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '결제 태그 이름 바꾸기' }))
    const input = screen.getByRole('textbox', { name: '태그 이름' })
    await userEvent.clear(input)
    await userEvent.type(input, '월 정산{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('공백과 #은 쓸 수 없고 30자까지예요')
    expect(calls).toEqual([])
  })

  it('삭제는 바로 화면에서 빼고, 되돌리기 토스트가 닫힐 때 DELETE를 보낸다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '견적 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.queryByText('#견적')).not.toBeInTheDocument()
    expect(screen.getByText('태그 1개를 지웠어요')).toBeInTheDocument()
    expect(calls).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', url: '/api/worklog/tags/t2', body: undefined }]))
  })

  it('되돌리면 태그를 다시 보여 주고 DELETE를 보내지 않는다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '견적 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByText('#견적')).toBeInTheDocument()
    expect(calls).toEqual([])
  })
  it('다른 동작의 토스트로 바뀌면 미뤄 둔 삭제를 바로 보낸다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '견적 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '개발 보관' }))
    expect(await screen.findByText('프로젝트 1개를 보관했어요')).toBeInTheDocument()
    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(['PATCH', 'DELETE']))
  })
  it('P1-02-07 지운 뒤 새로 고침·탭 닫기(pagehide)면 DELETE를 keepalive로 바로 한 번만 보낸다', async () => {
    const { calls, keepalives } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '견적 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(['DELETE']))
    expect(keepalives).toEqual([true])
    // 토스트도 치워서 닫힐 때 다시 보내지 않는다
    expect(screen.queryByText('태그 1개를 지웠어요')).not.toBeInTheDocument()
    window.dispatchEvent(new Event('pagehide'))
    expect(calls).toHaveLength(1)
  })

  it('P1-02-10 Enter·Esc로 편집을 끝내면 ✎로, 지우면 다음 태그의 ✎로 포커스가 간다', async () => {
    setup()
    const edit = await screen.findByRole('button', { name: '결제 태그 이름 바꾸기' })
    await userEvent.click(edit)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '결제 태그 이름 바꾸기' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: '결제 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(screen.getByRole('button', { name: '견적 태그 이름 바꾸기' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: '견적 태그 이름 바꾸기' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    // 남은 태그가 없으면 목록 머리로
    expect(screen.getByRole('heading', { name: '태그' })).toHaveFocus()
  })

  it('P1-02-11 키보드만으로(✎ Enter → Tab → [삭제] Enter) 지워도 이웃 태그 ✎, 없으면 제목으로 포커스가 간다', async () => {
    setup()
    const user = userEvent.setup()
    ;(await screen.findByRole('button', { name: '결제 태그 이름 바꾸기' })).focus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(screen.getByRole('button', { name: '삭제' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('#결제')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '견적 태그 이름 바꾸기' })).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('#견적')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '태그' })).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('태그 이름을 비우면 1자 이상 적으라고 알린다', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '결제 태그 이름 바꾸기' }))
    await userEvent.clear(screen.getByRole('textbox', { name: '태그 이름' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('태그 이름을 적어 주세요')
    expect(calls).toEqual([])
  })
})

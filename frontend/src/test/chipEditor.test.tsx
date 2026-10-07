// P1-09-12 칩 수정 드롭다운 · P1-10-08 명령 팔레트 업무 검색. 키보드 흐름을 기본으로 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const project = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  color: 'P2',
  archived: false,
  taskCount: 0,
  openTaskCount: 0,
  createdAt: '2026-10-01T00:00:00Z',
  version: 0,
  ...extra,
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

async function openHome(extra: Record<string, () => Response> = {}) {
  stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects?includeArchived=true': () =>
      json(200, {
        items: [
          project('p2', '영업'),
          project('p3', '개발'),
          project('p4', '옛일', { archived: true }),
          project('p5', '두 단어'),
        ],
      }),
    'GET /api/worklog/tags': () =>
      json(200, {
        items: [
          { id: 't1', name: '결제', usageCount: 4, createdAt: '2026-10-01T00:00:00Z', version: 0 },
          { id: 't2', name: '견적', usageCount: 9, createdAt: '2026-10-01T00:00:00Z', version: 0 },
        ],
      }),
    ...extra,
  })
  const result = renderApp('/')
  const input = await screen.findByRole('textbox', { name: '빠른 기록' })
  return { ...result, input }
}

const chip = (name: string | RegExp) =>
  within(screen.getByRole('list', { name: '해석 결과' })).getByRole('button', { name })

describe('P1-09-12 칩 수정 드롭다운', () => {
  it('키보드로 열면 지금 값에 포커스, ↓·Enter로 고르면 그 낱말만 바뀌고 입력창으로 돌아간다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '견적서 !높음 회신')
    const priority = chip('우선순위 높음')
    expect(priority).toHaveAttribute('aria-haspopup', 'menu')
    priority.focus()
    await userEvent.keyboard('{Enter}')
    const menu = screen.getByRole('menu', { name: '우선순위 고치기' })
    expect(within(menu).getByRole('menuitemradio', { name: /높음/ })).toHaveFocus()
    expect(priority).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(input).toHaveValue('견적서 !낮음 회신')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(chip('우선순위 낮음')).toBeInTheDocument()
  })

  it('Esc·Tab으로 닫으면 칩으로 포커스가 돌아오고 입력은 그대로다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '견적서 !높음')
    const priority = chip('우선순위 높음')
    priority.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(priority).toHaveFocus()
    // Esc가 입력창까지 가서 입력을 비우지 않는다
    expect(input).toHaveValue('견적서 !높음')
    await userEvent.keyboard('{Enter}{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(priority).toHaveFocus()
  })

  it('빼기를 고르면 그 낱말을 지우고 공백을 하나로 줄인다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '견적서 ~금 회신')
    await userEvent.click(chip('마감 10/9(금)'))
    await userEvent.click(screen.getByRole('menuitem', { name: '마감 빼기' }))
    expect(input).toHaveValue('견적서 회신')
    expect(input).toHaveFocus()
  })

  it('시간 없이 쓴 날짜의 마감 칩도 고칠 수 있고, 선택지는 실제 날짜를 함께 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '내일 보고서')
    await userEvent.click(chip('마감 10/8(목)'))
    const options = within(screen.getByRole('menu', { name: '마감 고치기' })).getAllByRole('menuitemradio')
    // 오늘이 수요일이라 모레와 금요일이 같은 날 → 하나만
    expect(options.map((o) => o.textContent)).toEqual([
      '오늘10/7(수)',
      '내일10/8(목)✓',
      '모레10/9(금)',
      '다음 월요일10/12(월)',
    ])
    await userEvent.click(options[3])
    expect(input).toHaveValue('~10/12 보고서')
  })

  it('프로젝트는 보관하지 않았고 @이름으로 쓸 수 있는 것만 고른다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '배포 @영업')
    const projectChip = await waitFor(() => chip('영업'))
    await userEvent.click(projectChip)
    const menu = screen.getByRole('menu', { name: '프로젝트 고치기' })
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((o) => o.textContent),
    ).toEqual(['영업✓', '개발'])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('배포 @개발')
  })

  it('태그는 지금 태그와 이 입력에 없는 자주 쓰는 태그를 보여 준다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '정리 #결제 #메모')
    await userEvent.click(await screen.findByRole('button', { name: '새 태그 메모' }))
    const menu = screen.getByRole('menu', { name: '태그 메모 고치기' })
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((o) => o.textContent),
    ).toEqual(['#메모✓', '#견적'])
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: '#견적' }))
    expect(input).toHaveValue('정리 #결제 #견적')
  })

  it('시간 칩은 시작·끝을 고치는 작은 창이고, 끝이 시작보다 이르면 바꾸지 못한다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '14-16 회의')
    const time = chip('오늘 14:00–16:00')
    expect(time).toHaveAttribute('aria-haspopup', 'dialog')
    time.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: '시간 고치기' })
    const start = within(dialog).getByLabelText('시작')
    expect(start).toHaveFocus()
    const end = within(dialog).getByLabelText('끝')
    fireEvent.change(end, { target: { value: '13:00' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('끝 시각은 시작보다 늦어야 해요')
    expect(within(dialog).getByRole('button', { name: '바꾸기' })).toBeDisabled()
    fireEvent.change(end, { target: { value: '17:30' } })
    end.focus()
    await userEvent.keyboard('{Enter}')
    expect(input).toHaveValue('14:00-17:30 회의')
    expect(input).toHaveFocus()
  })

  it('바깥을 누르면 닫히고 포커스는 누른 곳에 둔다', async () => {
    const { input } = await openHome()
    await userEvent.type(input, '견적서 !높음')
    await userEvent.click(chip('우선순위 높음'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.click(input)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })
})

describe('P1-10-08 명령 팔레트 업무 검색', () => {
  const search = {
    'GET /api/worklog/tasks': () => json(200, { items: [], nextCursor: null }),
  }

  it('제목으로 찾은 업무를 "업무" 묶음에 보여 주고, 고르면 업무 상세로 간다', async () => {
    const { router } = await openHome({
      ...search,
      'GET /api/worklog/tasks?q=%EA%B2%AC%EC%A0%81&sort=created&limit=5': () =>
        json(200, {
          items: [task('k1', '견적서 회신'), task('k2', '견적 검토', { status: 'DONE' })],
          nextCursor: null,
        }),
      // 고른 업무의 상세 패널이 받는다
      'GET /api/worklog/tasks/k1': () => json(200, task('k1', '견적서 회신')),
    })
    await userEvent.keyboard('{Control>}k{/Control}견적')
    const group = await screen.findByRole('group', { name: '업무' })
    const options = within(group).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['○견적서 회신', '✓견적 검토완료'])
    // 맞는 명령이 없으면 업무로 추가 제안이 맨 앞
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('‘견적’을 업무로 추가')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(router.state.location.pathname).toBe('/tasks/k1')
    expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).not.toBeInTheDocument()
  })

  it('찾은 업무가 없으면 묶음을 그리지 않는다(업무로 추가 제안만)', async () => {
    await openHome(search)
    await userEvent.keyboard('{Control>}k{/Control}없는일')
    // 멈춘 뒤 검색(0.2초)·응답이 끝나도 업무 묶음은 없다
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.queryByRole('group', { name: '업무' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('검색에 실패하면 묶음 안에 안내만 보인다', async () => {
    await openHome({ 'GET /api/worklog/tasks': () => json(500, {}) })
    await userEvent.keyboard('{Control>}k{/Control}견적')
    expect(await screen.findByText('업무를 불러오지 못했어요')).toBeInTheDocument()
  })
})

// SCR-COM-02 ④ 자주 하는 업무 제안 (P1-09-10, GET /api/worklog/tasks/frequent)
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, ME, renderApp, stubFetch } from './renderApp'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const FREQUENT = [
  { title: '주간 회의 준비', projectId: 'p2', tagIds: ['t1'], latestTaskId: 'a', count: 5 },
  { title: '메일 정리', projectId: null, tagIds: [], latestTaskId: 'b', count: 3 },
]

function open(items: object[] = FREQUENT, { failFirst = false } = {}) {
  let failed = false
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/tasks/frequent': () => {
      if (failFirst && !failed) {
        failed = true
        return json(500, { status: 500, code: 'INTERNAL' })
      }
      return json(200, { items })
    },
    'GET /api/worklog/projects?includeArchived=true': () =>
      json(200, {
        items: [
          {
            id: 'p2',
            name: '영업',
            color: 'P2',
            archived: false,
            taskCount: 4,
            openTaskCount: 4,
            createdAt: '2026-10-01T00:00:00Z',
            version: 0,
          },
        ],
      }),
    'GET /api/worklog/tags': () =>
      json(200, { items: [{ id: 't1', name: '회의', usageCount: 4, createdAt: '2026-10-01T00:00:00Z', version: 0 }] }),
  })
  renderApp('/')
  const frequentCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === '/api/worklog/tasks/frequent').length
  return { frequentCalls }
}

describe('SCR-COM-02 ④ 자주 하는 업무 제안', () => {
  it('포커스 전에는 부르지 않고, 포커스가 가면 제안을 보여 준다', async () => {
    const { frequentCalls } = open()
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    expect(frequentCalls()).toBe(0)
    await userEvent.click(input)
    const list = await screen.findByRole('list', { name: '자주 하는 업무' })
    expect(list).toHaveTextContent('주간 회의 준비')
    expect(screen.getByRole('button', { name: '주간 회의 준비, 영업' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메일 정리' })).toBeInTheDocument()
  })

  it('고르면 제목·@프로젝트·#태그로 채우고 입력창으로 돌아간다', async () => {
    open()
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    await userEvent.click(input)
    await userEvent.click(await screen.findByRole('button', { name: '주간 회의 준비, 영업' }))
    expect(input).toHaveValue('주간 회의 준비 @영업 #회의 ')
    expect(input).toHaveFocus()
    // 입력이 생기면 제안 대신 해석 칩이 보인다
    expect(screen.queryByRole('list', { name: '자주 하는 업무' })).not.toBeInTheDocument()
  })

  it('키보드: ↓로 제안에 들어가 화살표로 오가고, Esc면 입력창으로 돌아간다', async () => {
    open()
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    input.focus()
    await screen.findByRole('list', { name: '자주 하는 업무' })
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: '주간 회의 준비, 영업' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: '메일 정리' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveValue('주간 회의 준비 @영업 #회의 ')
  })

  it('입력창과 제안 밖으로 포커스가 나가면 닫힌다', async () => {
    open()
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    input.focus()
    await screen.findByRole('list', { name: '자주 하는 업무' })
    await userEvent.tab() // 입력창 → 문법 도움말(?) 버튼(같은 빠른 입력 안)
    expect(screen.getByRole('list', { name: '자주 하는 업무' })).toBeInTheDocument()
    ;(document.activeElement as HTMLElement).blur()
    await waitFor(() => expect(screen.queryByRole('list', { name: '자주 하는 업무' })).not.toBeInTheDocument())
  })

  it('제안이 0개면 아무것도 보이지 않는다', async () => {
    const { frequentCalls } = open([])
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    await userEvent.click(input)
    await waitFor(() => expect(frequentCalls()).toBe(1))
    expect(screen.queryByText('자주 하는 업무')).not.toBeInTheDocument()
  })

  it('같은 15분 칸 안에서는 다시 부르지 않는다', async () => {
    const { frequentCalls } = open()
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    input.focus()
    await screen.findByRole('list', { name: '자주 하는 업무' })
    input.blur()
    input.focus()
    await screen.findByRole('list', { name: '자주 하는 업무' })
    expect(frequentCalls()).toBe(1)
  })

  it('못 받았으면 조용히 넘기고, 다음 포커스 때 다시 받는다', async () => {
    const { frequentCalls } = open(FREQUENT, { failFirst: true })
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    input.focus()
    await waitFor(() => expect(frequentCalls()).toBe(1))
    expect(screen.queryByRole('list', { name: '자주 하는 업무' })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50)) // 실패 응답이 끝까지 처리되기를 기다린다
    input.blur()
    input.focus()
    await screen.findByRole('list', { name: '자주 하는 업무' })
    expect(frequentCalls()).toBe(2)
  })
})

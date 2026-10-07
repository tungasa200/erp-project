// qa 결함·관찰 회귀 테스트 (P1-09-01 칩 class, P1-09-08 도움말 Esc 포커스, 개발 모드 팔레트 포커스)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../app/router'
import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/Toast'
import { json, ME, renderApp, stubFetch } from './renderApp'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T03:00:00Z')) // 서울 10/7(수) 12:00
  stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'GET /api/worklog/projects?includeArchived=true': () => json(200, { items: [] }),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SCR-COM-02 qa 회귀', () => {
  it('P1-09-01 칩 class에 undefined가 들어가지 않고 마감·우선순위 칩은 종류 class를 갖는다', async () => {
    renderApp('/')
    await userEvent.type(await screen.findByRole('textbox', { name: '빠른 기록' }), '견적서 회신 @영업 !낮음 ~금')
    const chips = within(screen.getByRole('list', { name: '해석 결과' })).getAllByRole('button')
    for (const chip of chips) expect(chip.className).not.toContain('undefined')
    expect(chips.find((c) => c.textContent === '마감 10/9(금)')).toHaveClass('chip', 'due')
    expect(chips.find((c) => c.textContent === '우선순위 낮음')).toHaveClass('chip', 'priority')
    expect(chips.find((c) => c.textContent === '우선순위 낮음')).not.toHaveClass('strong')
  })

  it('P1-09-08 문법 도움말을 Esc로 닫으면 ? 버튼으로 포커스가 돌아온다', async () => {
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    const help = screen.getByRole('button', { name: '문법 도움말' })
    await userEvent.click(help)
    expect(screen.getByRole('dialog', { name: '한 줄 입력 문법' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '한 줄 입력 문법' })).not.toBeInTheDocument()
    expect(help).toHaveFocus()
  })

  it('P1-01-11 키보드 단축키를 끄면 입력창의 N 안내를 숨긴다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, { ...ME, keyboardShortcutsEnabled: false }) })
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    expect(document.querySelector('kbd')).toBeNull()
  })

  it('단축키가 켜져 있으면 N 안내를 보여 준다', async () => {
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    expect(document.querySelector('kbd')).toHaveTextContent('N')
  })

  it('도움말 표는 날짜만 쓰면 마감일이라고 알린다 (D-62)', async () => {
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    await userEvent.click(screen.getByRole('button', { name: '문법 도움말' }))
    expect(screen.getByText('날짜 (시간 없이 쓰면 마감일)')).toBeInTheDocument()
  })
})

describe('SCR-COM-03 개발 모드(StrictMode)', () => {
  it('입력창에서 Ctrl+K로 열어도 포커스가 팔레트에 있고, Esc로 닫으면 입력창으로 돌아온다', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AuthProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
    const input = await screen.findByRole('textbox', { name: '빠른 기록' })
    await userEvent.type(input, '회의')
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '명령 팔레트' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(input).toHaveValue('회의')
  })
})

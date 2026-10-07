import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 모바일 하단 탭은 CSS로만 숨겨 jsdom에서는 늘 있다
describe('SCR-COM-01 ⑤ 모바일 하단 탭 (P1-X-01)', () => {
  it('더보기를 누르면 업무·설정 메뉴가 열려 첫 항목으로 포커스가 가고, Esc로 닫으면 더보기로 돌아온다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    const more = within(tabs).getByRole('button', { name: '더보기' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const menu = within(tabs).getByRole('list', { name: '더보기 메뉴' })
    expect(more).toHaveAttribute('aria-controls', menu.id)
    expect(
      within(menu)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['업무', '설정'])
    expect(within(menu).getByRole('link', { name: '업무' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(within(tabs).queryByRole('list', { name: '더보기 메뉴' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('메뉴에서 고르면 그 화면으로 가고 메뉴를 닫는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '더보기' }))
    await userEvent.click(within(tabs).getByRole('link', { name: '업무' }))
    expect(router.state.location.pathname).toBe('/tasks')
    expect(within(tabs).queryByRole('list', { name: '더보기 메뉴' })).not.toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: '더보기' })).toHaveFocus()
  })

  it('가운데 +는 홈으로 가서 빠른 입력칸에 포커스한다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/tasks')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '빠른 기록' }))
    expect(router.state.location.pathname).toBe('/')
    await waitFor(() => expect(screen.getByRole('textbox', { name: '빠른 기록' })).toHaveFocus())
  })

  it('오프라인이면 가운데 +를 막는다 (SCR-SYS-02 ③)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/tasks')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    const quick = within(tabs).getByRole('button', { name: '빠른 기록' })
    expect(quick).toBeDisabled()
    await userEvent.click(quick)
    expect(router.state.location.pathname).toBe('/tasks')
  })
})

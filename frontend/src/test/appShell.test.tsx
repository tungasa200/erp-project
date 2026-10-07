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

describe('SCR-COM-03 ② 타이머 명령 (P2-06)', () => {
  const running = { id: 't-1', content: '보고서 작성', startAt: '2026-10-07T00:00:00Z', endAt: null }
  const openPalette = async () => {
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await userEvent.keyboard('{Control>}k{/Control}')
    return screen.findByRole('dialog', { name: '명령 팔레트' })
  }

  it('시간 기록 옵션이 꺼져 있으면 타이머 명령이 없다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')
    const palette = await openPalette()
    expect(within(palette).queryByText(/타이머/)).not.toBeInTheDocument()
  })

  it('켜져 있고 실행 중이면 정지·전환, 정지는 POST /timer/stop 후 결과 토스트', async () => {
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () => json(200, { userId: 'u-1', settings: { timeTrackingEnabled: true } }),
      'GET /api/worklog/timer': () => json(200, { running }),
      'POST /api/worklog/timer/stop': () =>
        json(200, {
          stopped: { record: { ...running, endAt: '2026-10-07T01:00:00Z' }, discarded: false, capped: false },
          next: null,
        }),
    })
    renderApp('/')
    await screen.findAllByRole('region', { name: '타이머: 보고서 작성' })
    let palette = await openPalette()
    expect(within(palette).getByText('타이머 — 다른 업무로 전환')).toBeInTheDocument()
    await userEvent.click(within(palette).getByText('타이머 정지'))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/worklog/timer/stop', expect.objectContaining({ method: 'POST' })),
    )
    expect(await screen.findByText('기록을 남겼어요')).toBeInTheDocument()

    palette = await openPalette()
    // 서버는 계속 실행 중이라고 답하므로 전환 문구로 시작 창이 열린다
    await userEvent.click(within(palette).getByText('타이머 — 다른 업무로 전환'))
    expect(await screen.findByRole('dialog', { name: '다른 업무로 전환' })).toBeInTheDocument()
  })

  it('끊겼으면 정지·전환 옆에 연결 끊김을 보이고, 실행해도 요청 없이 이유를 알린다 (SCR-SYS-02 ③)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () => json(200, { userId: 'u-1', settings: { timeTrackingEnabled: true } }),
      'GET /api/worklog/timer': () => json(200, { running }),
    })
    renderApp('/')
    await screen.findAllByRole('region', { name: '타이머: 보고서 작성' })
    let palette = await openPalette()
    const stop = within(palette).getByRole('option', { name: /타이머 정지/ })
    expect(stop).toHaveTextContent('연결 끊김')
    await userEvent.click(stop)
    expect(await screen.findByText('연결되면 타이머를 멈출 수 있어요')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/worklog/timer/stop', expect.anything())

    palette = await openPalette()
    await userEvent.click(within(palette).getByRole('option', { name: /다른 업무로 전환/ }))
    expect(await screen.findByText('연결되면 타이머를 바꿀 수 있어요')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '다른 업무로 전환' })).not.toBeInTheDocument()
  })
})

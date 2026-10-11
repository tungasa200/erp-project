// SCR-MOB-02 PWA 설치 안내(보드 MOB-02a). 카드는 ≤767px CSS로만 보이지만 jsdom은 CSS를 적용하지 않아 그대로 찾는다.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listenForInstallPrompt } from '../pwa/install'
import { json, ME, renderApp, stubFetch } from './renderApp'

beforeAll(() => listenForInstallPrompt())

beforeEach(() => {
  sessionStorage.clear()
  stubFetch({ 'GET /api/users/me': () => json(200, ME) })
})

afterEach(() => {
  // 쓰지 않은 설치 이벤트가 다음 시험으로 넘어가지 않게 비운다(localStorage는 setup이 비운다)
  window.dispatchEvent(new Event('appinstalled'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 이전 방문 수를 정해 두면 이번 홈 진입이 한 번 더 센다 */
const visitedBefore = (n: number) => localStorage.setItem('wy.install.visits', String(n))

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('SCR-MOB-02 설치 안내', () => {
  it('두 번째 방문에 브라우저가 설치 창을 줄 수 있으면 카드를 띄우고, [설치] → 설치하면 토스트, 포커스는 홈 탭으로', async () => {
    visitedBefore(1)
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    const event = fireInstallPrompt('accepted')
    expect(event.defaultPrevented).toBe(true)

    const card = await screen.findByRole('region', { name: 'WY Worklog 앱 설치' })
    expect(within(card).getByText('홈 화면에서 바로 열고 알림도 받아요')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(within(card).getByRole('button', { name: '설치' }))

    expect(event.prompt).toHaveBeenCalled()
    expect(await screen.findByText('홈 화면에 WY Worklog를 추가했어요')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: '하단 탭' })
    expect(within(tabs).getByRole('link', { current: 'page' })).toHaveFocus()
    expect(localStorage.getItem('wy.install.done')).toBe('1')
  })

  it('첫 방문에는 띄우지 않는다', async () => {
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    fireInstallPrompt()
    expect(screen.queryByRole('region', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
  })

  it('×는 30일 숨김(키보드로), 다시 열어도 안 뜬다', async () => {
    visitedBefore(1)
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    fireInstallPrompt()
    const card = await screen.findByRole('region', { name: 'WY Worklog 앱 설치' })
    const user = userEvent.setup()
    within(card).getByRole('button', { name: '30일 동안 숨기기' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('region', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
    const until = Number(localStorage.getItem('wy.install.hiddenUntil'))
    expect(until - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000)

    cleanup()
    sessionStorage.clear()
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    expect(screen.queryByRole('region', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
  })

  it('브라우저 창에서 취소해도 30일 숨김', async () => {
    visitedBefore(1)
    renderApp('/')
    await screen.findByRole('textbox', { name: '빠른 기록' })
    fireInstallPrompt('dismissed')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '설치' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument())
    expect(Number(localStorage.getItem('wy.install.hiddenUntil'))).toBeGreaterThan(Date.now())
    expect(screen.queryByText('홈 화면에 WY Worklog를 추가했어요')).not.toBeInTheDocument()
  })

  it('iPhone Safari는 공유 → 홈 화면에 추가 안내 카드', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    )
    visitedBefore(1)
    renderApp('/')
    const card = await screen.findByRole('region', { name: '홈 화면에 WY Worklog 추가' })
    const steps = within(card).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['아래 공유 버튼을 누르세요', '홈 화면에 추가를 고르세요'])
  })

  it('홈 화면 앱으로 열었으면 띄우지 않는다', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      visitedBefore(1)
      renderApp('/')
      await screen.findByRole('textbox', { name: '빠른 기록' })
      expect(screen.queryByRole('region', { name: '홈 화면에 WY Worklog 추가' })).not.toBeInTheDocument()
    } finally {
      delete (navigator as { standalone?: boolean }).standalone
    }
  })

  it('설정 › 일반: 설치 창을 줄 수 있을 때만 [WY Worklog 앱 설치] 버튼', async () => {
    renderApp('/settings/general')
    await screen.findByRole('heading', { name: '일반' })
    expect(screen.queryByRole('button', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
    const event = fireInstallPrompt('accepted')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'WY Worklog 앱 설치' }))

    expect(event.prompt).toHaveBeenCalled()
    expect(await screen.findByText('홈 화면에 WY Worklog를 추가했어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'WY Worklog 앱 설치' })).not.toBeInTheDocument()
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 모바일 하단 탭은 CSS로만 숨겨 jsdom에서는 늘 있다
describe('SCR-COM-01 ⑤ 모바일 하단 탭 (P1-X-01)', () => {
  it('더보기를 누르면 알림·통계·보관함·설정 메뉴가 열려 첫 항목으로 포커스가 가고, Esc로 닫으면 더보기로 돌아온다', async () => {
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
    ).toEqual(['알림', '통계', '보관함', '설정', '사용 설명서↗'])
    expect(within(menu).getByRole('link', { name: '알림' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(within(tabs).queryByRole('list', { name: '더보기 메뉴' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('메뉴에서 고르면 그 화면으로 가고 메뉴를 닫는다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '더보기' }))
    await userEvent.click(within(tabs).getByRole('link', { name: '통계' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/stats'))
    expect(within(tabs).queryByRole('list', { name: '더보기 메뉴' })).not.toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: '더보기' })).toHaveFocus()
  })
  it('맨 아래 사용 설명서는 새 탭 링크이고, 누르면 메뉴를 닫고 더보기로 돌아온다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const { router } = renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '더보기' }))
    const manual = within(tabs).getByRole('link', { name: '사용 설명서, 새 탭에서 열림' })
    expect(manual).toHaveAttribute('href', '/manual/index.html')
    expect(manual).toHaveAttribute('target', '_blank')
    expect(manual).toHaveAttribute('rel', 'noopener')
    // jsdom은 새 탭을 열지 않으므로 기본 동작만 막고 메뉴 쪽 동작을 본다
    manual.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(manual)
    expect(within(tabs).queryByRole('list', { name: '더보기 메뉴' })).not.toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: '더보기' })).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
  })
  it('UX-M-COM-12 안 읽은 알림이 있으면 더보기의 알림 항목에 수를 붙인다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/notifications': () => json(200, { items: [], nextCursor: null, unreadCount: 3 }),
    })
    renderApp('/')
    const tabs = await screen.findByRole('navigation', { name: '하단 탭' })
    await userEvent.click(within(tabs).getByRole('button', { name: '더보기' }))
    expect(await within(tabs).findByRole('link', { name: '알림 (3)' })).toHaveAttribute('href', '/notifications')
  })
  // 가운데 +(빠른 기록 시트, 끊긴 동안 입력 막힘)는 quickSheet.test.tsx (P4-03)
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

describe('SCR-COM-03 사용 설명서 (D-218)', () => {
  it('검색어 "매뉴얼"로 찾고, 고르면 새 탭으로 /manual/index.html을 연다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderApp('/')
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await userEvent.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: '명령 팔레트' })
    await userEvent.keyboard('매뉴얼')
    await userEvent.click(within(palette).getByRole('option', { name: '사용 설명서, 새 탭에서 열림' }))
    expect(open).toHaveBeenCalledWith('/manual/index.html', '_blank', 'noopener')
  })
})

describe('P4 화면 경로 연결 (통계·보관함)', () => {
  it('/stats는 통계 화면, 업무 목록 아래 "보관함"은 /tasks/archive 보관함 화면', async () => {
    const empty = { completedTaskCount: 0, recordCount: 0, confirmedLogCount: 0, daily: [], projects: [] }
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/stats': () => json(200, { from: '', to: '', ...empty, firstRecordDate: null }),
      'GET /api/worklog/stats/plan-vs-actual': () => json(200, { from: '', to: '', weeks: [], topDiffs: [] }),
    })
    const { router } = renderApp('/stats')
    const title = await screen.findByRole('heading', { level: 1, name: '통계' })
    // 본문 랜드마크는 셸의 <main> 하나뿐이고 화면 제목이 그 안에 있다
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(title)

    await router.navigate('/tasks')
    await userEvent.click(await screen.findByRole('link', { name: '보관함' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/archive'))
    expect(await screen.findByRole('heading', { level: 1, name: '보관함' })).toBeInTheDocument()
  })
})

describe('SCR-COM-01 사이드바 사용 설명서 (사용자 결정 2026-10-13)', () => {
  it('[설정] 바로 위에 새 탭으로 여는 사용 설명서 링크가 있다', async () => {
    stubFetch({ 'GET /api/users/me': () => json(200, ME) })
    renderApp('/')
    const sidebar = await screen.findByRole('navigation', { name: '주 메뉴' })
    const links = within(sidebar).getAllByRole('link')
    const manual = within(sidebar).getByRole('link', { name: '사용 설명서, 새 탭에서 열림' })
    expect(links.indexOf(manual)).toBe(links.indexOf(within(sidebar).getByRole('link', { name: '설정' })) - 1)
    expect(manual).toHaveAttribute('href', '/manual/index.html')
    expect(manual).toHaveAttribute('target', '_blank')
    expect(manual).toHaveAttribute('rel', 'noopener')
    // 접힌 레일(태블릿)에서는 글자가 숨으므로 마우스 툴팁도 둔다
    expect(manual).toHaveAttribute('title', '사용 설명서 (새 탭)')
  })
})

describe('SCR-COM-05 ② 알림 종 배치 (P4-01)', () => {
  it('사이드바 위(브랜드 줄)에 종이 있고 안 읽은 수를 이름으로 읽는다. 홈 머리에도 모바일용 종이 있다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/notifications': () => json(200, { items: [], nextCursor: null, unreadCount: 12 }),
    })
    renderApp('/')
    const sidebar = await screen.findByRole('navigation', { name: '주 메뉴' })
    expect(await within(sidebar).findByRole('button', { name: '알림, 안 읽음 12개' })).toHaveTextContent('9+')
    // 홈 머리의 종은 CSS로 모바일에서만 보인다(jsdom은 둘 다 그린다)
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!
    expect(within(header).getByRole('button', { name: '알림, 안 읽음 12개' })).toBeInTheDocument()
  })
})

describe('SCR-COM-01 사이드바 프로젝트 만들기·관리 (D-226)', () => {
  const sales = {
    id: 'p-sales',
    name: '영업',
    color: 'P2',
    archived: false,
    taskCount: 0,
    openTaskCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    version: 0,
  }

  it('프로젝트가 없어도 제목 줄의 [+]로 그 자리에서 만들고, 만든 뒤 목록에 넣고 [+]로 돌아온다', async () => {
    const sent: unknown[] = []
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/projects': () => json(200, { items: [] }),
      'POST /api/worklog/projects': (init) => {
        const body = JSON.parse(String(init?.body))
        sent.push(body)
        return json(201, { ...sales, id: 'p-new', name: body.name, color: body.color })
      },
    })
    renderApp('/')
    const sidebar = await screen.findByRole('navigation', { name: '주 메뉴' })
    const add = await within(sidebar).findByRole('button', { name: '새 프로젝트' })
    expect(within(sidebar).getByRole('link', { name: '프로젝트 관리' })).toHaveAttribute('href', '/settings/projects')

    await userEvent.click(add)
    const input = within(sidebar).getByRole('textbox', { name: '새 프로젝트 이름' })
    expect(input).toHaveFocus()
    await userEvent.type(input, '  신규 고객  {Enter}')
    expect(await within(sidebar).findByRole('link', { name: '신규 고객, 남은 업무 0개' })).toBeInTheDocument()
    expect(sent).toEqual([{ name: '신규 고객', color: 'P1' }])
    expect(within(sidebar).queryByRole('textbox', { name: '새 프로젝트 이름' })).not.toBeInTheDocument()
    expect(add).toHaveFocus()
    expect(screen.getByText('‘신규 고객’ 프로젝트를 만들었어요')).toBeInTheDocument()
  })

  it('같은 이름이면 칸 아래에 알리고 칸을 둔다. Esc는 만들지 않고 [+]로 돌아온다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/projects': () => json(200, { items: [sales] }),
      'POST /api/worklog/projects': () => problem(409, 'DUPLICATE_NAME'),
    })
    renderApp('/')
    const sidebar = await screen.findByRole('navigation', { name: '주 메뉴' })
    const add = await within(sidebar).findByRole('button', { name: '새 프로젝트' })
    await userEvent.click(add)
    const input = within(sidebar).getByRole('textbox', { name: '새 프로젝트 이름' })
    await userEvent.type(input, '영업{Enter}')
    expect(await within(sidebar).findByRole('alert')).toHaveTextContent('같은 이름의 프로젝트가 있어요')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(within(sidebar).queryByRole('textbox', { name: '새 프로젝트 이름' })).not.toBeInTheDocument()
    expect(add).toHaveFocus()
  })
})

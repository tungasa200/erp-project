import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Me = Record<string, unknown> & { version: number }
type PatchHook = (body: Record<string, unknown>) => Response | undefined | Promise<Response | undefined>

// identity를 흉내 낸 서버: version이 맞으면 보낸 칸을 반영하고 version을 올린다.
function fakeServer(options: { patch?: PatchHook } = {}) {
  let server: Me = { ...ME }
  const patches: Record<string, unknown>[] = []
  const fetchMock = stubFetch({
    'GET /api/users/me': () => json(200, server),
    'PATCH /api/users/me': async (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      patches.push(body)
      const custom = await options.patch?.(body)
      if (custom) return custom
      if (body.version !== server.version) return problem(409, 'VERSION_CONFLICT')
      const { version: _, ...fields } = body
      for (const [k, v] of Object.entries(fields)) fields[k] = typeof v === 'string' ? v.trim() || null : v
      server = { ...server, ...fields, version: server.version + 1 }
      return json(200, server)
    },
    'POST /api/worklog/me/profile/refresh': () => json(200, {}),
  })
  const refreshCalls = () =>
    fetchMock.mock.calls.filter(([url, init]) => url === '/api/worklog/me/profile/refresh' && init?.method === 'POST')
      .length
  return {
    patches,
    refreshCalls,
    setServer: (next: Partial<Me>) => (server = { ...server, ...next }),
  }
}

describe('설정 화면 틀', () => {
  it('/settings는 데스크톱에서 프로필 탭을 바로 연다', async () => {
    fakeServer()
    const { router } = renderApp('/settings')
    expect(await screen.findByRole('heading', { name: '프로필' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/profile')
    expect(within(screen.getByRole('navigation', { name: '설정 메뉴' })).getAllByRole('link')).toHaveLength(5)
  })

  it('사이드바 프로필 영역을 누르면 프로필 설정으로 간다', async () => {
    fakeServer()
    const { router } = renderApp('/')
    await userEvent.click(await screen.findByTitle('프로필 설정'))
    expect(router.state.location.pathname).toBe('/settings/profile')
  })
})

describe('SCR-SET-01 프로필', () => {
  it('칸을 벗어나면 저장하고 worklog 사본을 다시 읽게 한다', async () => {
    const server = fakeServer()
    renderApp('/settings/profile')
    const name = await screen.findByRole('textbox', { name: '이름' })
    expect(screen.getByRole('textbox', { name: '이메일' })).toHaveAttribute('readonly')

    await userEvent.type(name, '  홍길동 ')
    expect(within(screen.getByText('작성자').parentElement!).getByText('홍길동')).toBeInTheDocument()
    await userEvent.tab()
    await waitFor(() => expect(server.patches).toEqual([{ name: '홍길동', version: 0 }]))
    await waitFor(() => expect(server.refreshCalls()).toBe(1))

    // 바뀐 것이 없으면 다시 보내지 않는다
    await userEvent.click(name)
    await userEvent.tab()
    expect(server.patches).toHaveLength(1)
  })

  it('비우면 null로 지운다', async () => {
    const server = fakeServer()
    server.setServer({ organization: '개발팀' })
    renderApp('/settings/profile')
    const org = await screen.findByRole('textbox', { name: '소속' })
    await userEvent.clear(org)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(server.patches).toEqual([{ organization: null, version: 0 }]))
  })

  it('저장은 차례로 보내고 앞 응답의 version으로 다음 저장을 보낸다', async () => {
    let releaseFirst: () => void = () => {}
    const firstDone = new Promise<void>((r) => (releaseFirst = r))
    const server = fakeServer({
      patch: async (body) => {
        if (body.organization) await firstDone
        return undefined
      },
    })
    renderApp('/settings/profile')
    await userEvent.type(await screen.findByRole('textbox', { name: '소속' }), '개발팀')
    await userEvent.type(screen.getByRole('textbox', { name: '직책' }), '매니저') // 소속 칸을 벗어나며 저장 시작
    await userEvent.tab()
    // 첫 응답 전에는 두 번째를 보내지 않는다
    expect(server.patches).toEqual([{ organization: '개발팀', version: 0 }])
    releaseFirst()
    await waitFor(() => expect(server.patches[1]).toEqual({ position: '매니저', version: 1 }))
  })

  it('다른 곳에서 먼저 고쳤으면(409) 충돌 띠를 띄우고, 새로 불러오면 서버 값으로 채운다', async () => {
    const server = fakeServer()
    renderApp('/settings/profile')
    const name = await screen.findByRole('textbox', { name: '이름' })
    server.setServer({ name: '다른탭', version: 3 })

    await userEvent.type(name, '홍길동')
    await userEvent.tab()
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요')

    await userEvent.click(within(banner).getByRole('button', { name: '새로 불러오기' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('다른탭'))
    expect(screen.queryByText(/먼저 수정됐어요/)).not.toBeInTheDocument()
  })

  it('입력 오류는 그 칸 아래에 보여 준다', async () => {
    fakeServer({ patch: () => problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'name', code: 'TOO_LONG' }] }) })
    renderApp('/settings/profile')
    const name = await screen.findByRole('textbox', { name: '이름' })
    await userEvent.type(name, '가')
    await userEvent.tab()
    expect(await screen.findByText('100자 이하로 적어 주세요')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
  })

  it('서버 오류면 문의 코드와 다시 시도를 보여 주고, 다시 시도하면 저장한다', async () => {
    let fail = true
    const server = fakeServer({ patch: () => (fail ? problem(500, 'INTERNAL_ERROR') : undefined) })
    renderApp('/settings/profile')
    await userEvent.type(await screen.findByRole('textbox', { name: '직책' }), '팀장')
    await userEvent.tab()
    expect(await screen.findByText('저장하지 못했어요')).toBeInTheDocument()
    expect(screen.getByText('trace-123')).toBeInTheDocument()

    fail = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument())
    expect(server.patches.at(-1)).toEqual({ position: '팀장', version: 0 })
  })
})

describe('SCR-SET-02 일반', () => {
  it('시간대는 검색해서 고르면 저장하고, 바꾼 뒤에만 안내를 보여 준다', async () => {
    const server = fakeServer()
    renderApp('/settings/general')
    const tz = await screen.findByRole('combobox', { name: '시간대' })
    expect(tz).toHaveValue('Asia/Seoul (UTC+09:00)')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()

    await userEvent.click(tz)
    await userEvent.clear(tz)
    await userEvent.type(tz, '도쿄')
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Asia/Tokyo (UTC+09:00)'])
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(server.patches).toEqual([{ timezone: 'Asia/Tokyo', version: 0 }]))
    expect(tz).toHaveValue('Asia/Tokyo (UTC+09:00)')
    expect(screen.getByRole('note')).toHaveTextContent('시간대를 바꿔도 기존 기록의 날짜는 그대로예요')
  })

  it('시간대 목록 맨 위에 추천(감지한 시간대·Asia/Seoul)을 두고, Esc로 닫으면 고른 값으로 되돌린다', async () => {
    const server = fakeServer()
    renderApp('/settings/general')
    const tz = await screen.findByRole('combobox', { name: '시간대' })
    await userEvent.click(tz)
    const recommended = screen.getByRole('group', { name: '추천' })
    expect(within(recommended).getByRole('option', { name: 'Asia/Seoul (UTC+09:00)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.type(tz, 'zzz')
    expect(screen.getByText('찾는 시간대가 없어요')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(tz).toHaveValue('Asia/Seoul (UTC+09:00)')
    expect(server.patches).toEqual([])
  })

  it('주 시작 요일은 고르는 즉시 저장한다', async () => {
    const server = fakeServer()
    renderApp('/settings/general')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '주 시작 요일' }), 'SUNDAY')
    await waitFor(() => expect(server.patches).toEqual([{ weekStart: 'SUNDAY', version: 0 }]))
  })

  it('업무 요일은 비트마스크로 저장하고, 하루도 고르지 않으면 보내지 않는다', async () => {
    const server = fakeServer()
    server.setServer({ workDays: 1 }) // 월요일만
    renderApp('/settings/general')
    const days = await screen.findByRole('group', { name: '업무 요일' })
    const mon = within(days).getByRole('button', { name: '월' })
    expect(mon).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(mon)
    expect(screen.getByRole('alert')).toHaveTextContent('업무 요일을 하루 이상 골라 주세요')
    expect(server.patches).toEqual([])

    await userEvent.click(within(days).getByRole('button', { name: '일' }))
    await waitFor(() => expect(server.patches).toEqual([{ workDays: 65, version: 0 }]))
    expect(screen.queryByText('업무 요일을 하루 이상 골라 주세요')).not.toBeInTheDocument()
  })

  it('키보드 단축키를 끄면 저장하고(사본 재조회 없음) 한 글자 단축키가 꺼진다', async () => {
    const server = fakeServer()
    renderApp('/settings/general')
    const toggle = await screen.findByRole('switch', { name: '키보드 단축키 사용' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    // 행 제목을 눌러도 켜고 끈다(누르는 영역 넓히기, erp-design)
    expect(screen.getByText('키보드 단축키').tagName).toBe('LABEL')

    await userEvent.click(toggle)
    await waitFor(() => expect(server.patches).toEqual([{ keyboardShortcutsEnabled: false, version: 0 }]))
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(server.refreshCalls()).toBe(0)

    toggle.blur()
    await userEvent.keyboard('n')
    expect(screen.queryByRole('textbox', { name: '빠른 기록' })).not.toBeInTheDocument()
  })
})

describe('오프라인 (SCR-SYS-02 ③, P1-X-04)', () => {
  it('끊긴 동안 설정 입력은 막고, 탭 이동은 된다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fakeServer()
    const { router } = renderApp('/settings/profile')
    expect(await screen.findByRole('textbox', { name: '이름' })).toBeDisabled()
    await userEvent.click(screen.getByRole('link', { name: /일반/ }))
    expect(router.state.location.pathname).toBe('/settings/general')
  })
})

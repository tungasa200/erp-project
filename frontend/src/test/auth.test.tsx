import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { RequireAuth } from '../app/guards'
import { useAuth } from '../auth/useAuth'
import { LoginPage } from '../pages/LoginPage'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('라우팅', () => {
  it('비로그인 상태로 앱 화면에 들어오면 로그인 화면으로 보낸다', async () => {
    stubFetch({})
    const { router } = renderApp('/calendar')
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    // 처음 온 사용자에게는 세션 만료 안내를 띄우지 않는다
    expect(screen.queryByText(/다시 로그인해 주세요/)).not.toBeInTheDocument()
  })

  it('없는 주소는 404 화면', async () => {
    stubFetch({})
    renderApp('/no-such-page')
    expect(await screen.findByRole('heading', { name: '페이지를 찾을 수 없어요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/')
  })
})

describe('SCR-AUTH-02 로그인', () => {
  it('성공하면 원래 가려던 화면으로 이동한다', async () => {
    let loggedIn = false
    stubFetch({
      'GET /api/users/me': () => (loggedIn ? json(200, ME) : problem(401, 'UNAUTHENTICATED')),
      'POST /api/auth/login': () => {
        loggedIn = true
        return json(200, ME)
      },
    })
    const { router } = renderApp('/logs')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '업무일지' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/logs')
  })

  it('형식 오류는 칸 아래에 표시하고 요청하지 않는다', async () => {
    const fetchMock = stubFetch({})
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(screen.getByText('이메일 형식이 맞지 않아요')).toBeInTheDocument()
    expect(screen.getByText('입력해 주세요')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/login', expect.anything())
  })

  it('빈 칸은 칸 아래에 "입력해 주세요"', async () => {
    stubFetch({})
    renderApp('/login')
    const user = userEvent.setup()
    await screen.findByLabelText('이메일')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(screen.getAllByText('입력해 주세요')).toHaveLength(2)
  })

  it('INVALID_CREDENTIALS는 어느 쪽이 틀렸는지 밝히지 않고 안내한다', async () => {
    stubFetch({ 'POST /api/auth/login': () => problem(401, 'INVALID_CREDENTIALS') })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'wrong1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이메일 또는 비밀번호가 맞지 않아요')
    expect(alert).not.toHaveTextContent('잠시 후 다시 시도해 주세요')
  })

  it('실패 응답이 늦게 오면(서버 점진 지연) "잠시 후 다시 시도해 주세요"를 덧붙인다', async () => {
    stubFetch({
      'POST /api/auth/login': async () => {
        await new Promise((resolve) => setTimeout(resolve, 950))
        return problem(401, 'INVALID_CREDENTIALS')
      },
    })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'wrong1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('이메일 또는 비밀번호가 맞지 않아요')
    expect(alert).toHaveTextContent('잠시 후 다시 시도해 주세요')
  })

  it('AUTH_LOCKED면 잠금 안내와 남은 시간을 보여 주고 버튼을 막는다', async () => {
    stubFetch({ 'POST /api/auth/login': () => problem(429, 'AUTH_LOCKED', { retryAfterSeconds: 892 }) })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'wrong1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('15분 동안 로그인할 수 없어요.')
    const button = screen.getByRole('button', { name: /로그인 · 14:5\d 후 가능/ })
    // 잠긴 동안은 aria-disabled로 막는다(disabled면 포커스가 빠짐)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
  })

  it('서버 오류(5xx)는 문의 코드와 함께 토스트로 알린다', async () => {
    stubFetch({ 'POST /api/auth/login': () => problem(500, 'INTERNAL_ERROR') })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByText('잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요')).toBeInTheDocument()
    expect(screen.getByText('trace-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument()
  })
})

describe('SCR-SYS-02 점검', () => {
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  it('503 + code=MAINTENANCE면 라우터 대신 점검 화면을 보여 주고 Retry-After로 계산한 시각을 표시한다', async () => {
    stubFetch({
      'GET /api/users/me': () => {
        const res = problem(503, 'MAINTENANCE')
        res.headers.set('Retry-After', '1800')
        return res
      },
    })
    const before = hhmm(new Date(Date.now() + 1800_000))
    renderApp('/calendar')
    const heading = await screen.findByRole('heading', { name: '서비스 점검 중이에요' })
    const after = hhmm(new Date(Date.now() + 1800_000))
    const text = heading.nextElementSibling?.textContent ?? ''
    expect([`${before} 이후 다시 이용할 수 있어요.`, `${after} 이후 다시 이용할 수 있어요.`]).toContain(
      text.split(' 기록은')[0],
    )
    expect(screen.queryByRole('heading', { name: '로그인' })).not.toBeInTheDocument()
  })

  it('Retry-After가 없으면 "지금은 이용할 수 없어요"', async () => {
    stubFetch({ 'GET /api/users/me': () => problem(503, 'MAINTENANCE') })
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: '서비스 점검 중이에요' })).toBeInTheDocument()
    expect(screen.getByText(/지금은 이용할 수 없어요/)).toBeInTheDocument()
  })

  it('본문이 Problem이 아닌 503은 점검이 아니라 서버 오류로 처리한다', async () => {
    stubFetch({ 'POST /api/auth/login': () => new Response('Service Unavailable', { status: 503 }) })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'demo@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByText('잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '서비스 점검 중이에요' })).not.toBeInTheDocument()
  })
})

describe('SCR-AUTH-03 회원가입', () => {
  async function fillSignup(email: string, password: string, confirm = password) {
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), email)
    await user.type(screen.getByLabelText('비밀번호'), password)
    await user.type(screen.getByLabelText('비밀번호 확인'), confirm)
    await user.click(screen.getByLabelText('전체 동의'))
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    return user
  }

  it('국외 보관 안내 문구와 자세히 보기 링크가 있다', async () => {
    stubFetch({})
    renderApp('/signup')
    expect(
      await screen.findByText(/회원 정보와 서비스 이용 기록은 싱가포르 소재 서버\(Railway\)에 보관되며/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '자세히 보기' })).toHaveAttribute('href', '/privacy#overseas')
  })

  it('비밀번호 규칙 충족 여부를 입력하는 동안 표시한다', async () => {
    stubFetch({})
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklogs')
    const rules = screen.getByRole('list', { name: '비밀번호 규칙' })
    expect(rules).toHaveTextContent('✓ 8~64자 충족')
    expect(rules).toHaveTextContent('○ 영문·숫자 포함 미충족')
  })

  it('72바이트를 넘으면 한글 안내를 칸 아래에 바로 표시한다', async () => {
    stubFetch({})
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('비밀번호'), '가'.repeat(24) + 'a1')
    expect(
      screen.getByText('비밀번호가 너무 깁니다. 한글은 한 글자가 영문보다 많은 자리를 차지합니다.'),
    ).toBeInTheDocument()
  })

  it('비밀번호 확인이 다르면 요청하지 않는다', async () => {
    const fetchMock = stubFetch({})
    renderApp('/signup')
    await fillSignup('new@example.com', 'worklog20', 'worklog21')
    expect(screen.getByText('비밀번호가 일치하지 않습니다.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/signup', expect.anything())
  })

  it('가입 요청 본문은 계약(SignupRequest) 형태이고, 성공하면 홈으로 간다', async () => {
    let body: unknown
    let loggedIn = false
    stubFetch({
      'GET /api/users/me': () => (loggedIn ? json(200, ME) : problem(401, 'UNAUTHENTICATED')),
      'POST /api/auth/signup': (init) => {
        body = JSON.parse(String(init?.body))
        loggedIn = true
        return json(201, ME)
      },
    })
    const { router } = renderApp('/signup')
    await fillSignup(' New@Example.com ', 'worklog20')

    expect(await screen.findByRole('textbox', { name: '빠른 기록' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(body).toEqual({ email: 'New@Example.com', password: 'worklog20', agreeTerms: true, agreePrivacy: true })
  })

  it('EMAIL_ALREADY_EXISTS면 이메일 칸에 안내와 로그인 링크', async () => {
    stubFetch({ 'POST /api/auth/signup': () => problem(409, 'EMAIL_ALREADY_EXISTS') })
    renderApp('/signup')
    await fillSignup('demo@example.com', 'worklog20')

    expect(await screen.findByText(/이미 가입된 이메일입니다/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하기' })).toHaveAttribute('href', '/login')
  })

  it('서버의 칸별 오류(errors[])를 해당 칸 아래에 표시한다', async () => {
    stubFetch({
      'POST /api/auth/signup': () =>
        problem(400, 'VALIDATION_FAILED', {
          errors: [
            { field: 'email', code: 'EMAIL_INVALID' },
            { field: 'password', code: 'PASSWORD_SAME_AS_EMAIL' },
          ],
        }),
    })
    renderApp('/signup')
    await fillSignup('demo@example.com', 'worklog20')

    expect(await screen.findByText('이메일 형식이 올바르지 않습니다.')).toBeInTheDocument()
    expect(screen.getByText('비밀번호 규칙을 확인해 주십시오.')).toBeInTheDocument()
  })
})

describe('세션', () => {
  function Probe() {
    const { user, logout } = useAuth()
    return (
      <div>
        <span>{user?.email}</span>
        <button type="button" onClick={() => void logout()}>
          logout
        </button>
        <button type="button" onClick={() => void api.request('/api/worklog/me').catch(() => undefined)}>
          call
        </button>
        {/* 화면 이동 때처럼 요청 두 개를 함께 보낸다 (P1-X-03) */}
        <button
          type="button"
          onClick={() =>
            void Promise.all([
              api.request('/api/worklog/me').catch(() => undefined),
              api.request('/api/worklog/projects').catch(() => undefined),
            ])
          }
        >
          call both
        </button>
      </div>
    )
  }
  const probeRoutes = [
    { element: <RequireAuth />, children: [{ path: '/', element: <Probe /> }] },
    { path: '/login', element: <LoginPage /> },
  ]

  it('logout()은 POST /api/auth/logout 후 캐시를 비우고 로그인 화면으로 보낸다', async () => {
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () => json(200, { userId: 'u-1' }),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    })
    const { router, queryClient } = renderApp('/', probeRoutes)
    queryClient.setQueryData(['worklog', 'me'], { userId: 'u-1' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'logout' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(queryClient.getQueryData(['me'])).toBeNull()
    expect(queryClient.getQueryData(['worklog', 'me'])).toBeUndefined()
  })

  it('refresh까지 실패하면 로그인 화면에서 "다시 로그인해 주세요"를 보여 주고 원래 경로를 기억한다', async () => {
    let meCalls = 0
    stubFetch({
      // 첫 조회는 로그인 상태, 이후 access 만료 + refresh 실패
      'GET /api/users/me': () => (meCalls++ === 0 ? json(200, ME) : problem(401, 'UNAUTHENTICATED')),
    })
    const { router } = renderApp('/', probeRoutes)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'call' }))

    expect(await screen.findByText('다시 로그인해 주세요. 로그인 후 보던 화면으로 돌아가요.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.state).toMatchObject({ from: '/', reason: 'expired' })
  })

  it('P1-X-03 요청 여러 개가 함께 401 → refresh 실패여도 "다시 로그인해 주세요"를 보여 준다', async () => {
    let meCalls = 0
    stubFetch({
      'GET /api/users/me': () => (meCalls++ === 0 ? json(200, ME) : problem(401, 'UNAUTHENTICATED')),
      'GET /api/worklog/me': () => problem(401, 'UNAUTHENTICATED'),
      'GET /api/worklog/projects': () => problem(401, 'UNAUTHENTICATED'),
    })
    const { router } = renderApp('/', probeRoutes)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'call both' }))

    expect(await screen.findByText('다시 로그인해 주세요. 로그인 후 보던 화면으로 돌아가요.')).toBeInTheDocument()
    expect(router.state.location.state).toMatchObject({ from: '/', reason: 'expired' })
  })

  it('다른 기기에서 탈퇴해 USER_DELETED를 받으면 탈퇴 안내와 회원가입 링크를 보여 준다', async () => {
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'GET /api/worklog/me': () => problem(401, 'USER_DELETED'),
    })
    const { router } = renderApp('/', probeRoutes)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'call' }))

    const notice = await screen.findByText(/탈퇴 처리된 계정입니다\. 같은 이메일로 다시 가입할 수 있습니다\./)
    expect(within(notice).getByRole('link', { name: '회원가입' })).toHaveAttribute('href', '/signup')
    expect(screen.queryByText(/다시 로그인해 주세요/)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('새로 고침 직후 첫 조회가 USER_DELETED여도 탈퇴 안내를 보여 준다', async () => {
    stubFetch({ 'GET /api/users/me': () => problem(401, 'USER_DELETED') })
    renderApp('/calendar')
    expect(await screen.findByText(/탈퇴 처리된 계정입니다\./)).toBeInTheDocument()
  })
})

describe('SCR-SYS-02 ③ 오프라인 띠', () => {
  it('로그인 전 화면에도 띠를 띄우고 폼 입력을 막는다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({})
    renderApp('/login')
    expect(await screen.findByLabelText('이메일')).toBeDisabled()
    expect(screen.getByText('재시도 중…').parentElement).toHaveTextContent(
      '연결이 끊겼어요. 다시 연결되면 입력할 수 있어요',
    )
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled()
  })

  it('연결되면 띠가 사라지고 입력할 수 있다', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    stubFetch({})
    renderApp('/login')
    expect(await screen.findByLabelText('이메일')).toBeDisabled()
    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(/연결이 끊겼어요/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('이메일')).toBeEnabled()
  })
})

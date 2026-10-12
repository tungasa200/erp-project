import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/problem'
import { sendLimitMessage } from '../verification/api'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
const issued = () => ({ expiresAt: later(600), resendAvailableAt: later(60) })
const body = (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>

describe('SCR-AUTH-02 로그인 → 비밀번호 찾기', () => {
  it('로그인 화면에 비밀번호 찾기 링크가 있다', async () => {
    stubFetch({})
    renderApp('/login')
    expect(await screen.findByRole('link', { name: '비밀번호 찾기' })).toHaveAttribute('href', '/password/forgot')
  })
})

describe('SCR-AUTH-04·05 비밀번호 찾기·재설정', () => {
  async function toResetStep(handlers: Parameters<typeof stubFetch>[0] = {}) {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const record = (url: string, respond: (b: Record<string, unknown>) => Response) => (init?: RequestInit) => {
      calls.push({ url, body: body(init) })
      return respond(body(init))
    }
    stubFetch({
      'POST /api/auth/password-reset': record('request', () => json(202, issued())),
      'POST /api/auth/password-reset/verify': record('verify', (b) =>
        b.code === '123456'
          ? new Response(null, { status: 204 })
          : problem(400, 'CODE_MISMATCH', { attemptsRemaining: 3 }),
      ),
      'POST /api/auth/password-reset/confirm': record('confirm', () => new Response(null, { status: 204 })),
      ...handlers,
    })
    const { router } = renderApp('/password/forgot')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    await screen.findByRole('heading', { name: '비밀번호 재설정' })
    return { router, calls }
  }

  it('UX-AUTH-171 재설정 단계의 [이메일 바꾸기]는 쓴 주소를 채운 찾기 화면으로 돌아간다', async () => {
    await toResetStep()
    await userEvent.click(screen.getByRole('link', { name: '이메일 바꾸기' }))
    await screen.findByRole('heading', { name: '비밀번호 찾기' })
    expect(screen.getByRole('textbox', { name: '이메일' })).toHaveValue('me@example.com')
  })

  it('이메일 형식이 아니면 보내지 않는다', async () => {
    const fetchMock = stubFetch({})
    renderApp('/password/forgot')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'not-email')
    await userEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    expect(screen.getByText('이메일 형식이 맞지 않아요')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/password-reset')).toBe(false)
  })

  it('발송 한도(24시간 10통, D-64)를 넘으면 다시 받을 수 있는 시각을 알린다("내일"이라고 하지 않음)', async () => {
    stubFetch({ 'POST /api/auth/password-reset': () => problem(429, 'DAILY_SEND_LIMIT', { retryAfterSeconds: 3600 }) })
    renderApp('/password/forgot')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    // 로그인 전이라 브라우저 시간대로 보인다
    const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const candidates = [0, 1].map((m) => hhmm.format(new Date(Date.now() + 3600_000 - m * 60_000)))
    const alert = await screen.findByRole('alert')
    expect(candidates.map((t) => `코드는 24시간에 10통까지 받을 수 있어요. ${t} 이후에 다시 받을 수 있어요`)).toContain(
      alert.textContent,
    )
    expect(alert).not.toHaveTextContent('내일')
  })

  it('발송 한도 시각은 사용자 시간대로 보인다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T03:00:00Z'))
    const error = new ApiError(429, {
      type: 'about:blank',
      title: 'DAILY_SEND_LIMIT',
      status: 429,
      code: 'DAILY_SEND_LIMIT',
      traceId: 't',
      retryAfterSeconds: 3600,
    })
    expect(sendLimitMessage(error, 'Asia/Seoul')?.message).toBe(
      '코드는 24시간에 10통까지 받을 수 있어요. 13:00 이후에 다시 받을 수 있어요',
    )
    vi.useRealTimers()
  })

  it('비밀번호 찾기를 거치지 않고 들어오면 처음 단계로 보낸다', async () => {
    stubFetch({})
    const { router } = renderApp('/password/reset')
    await screen.findByRole('heading', { name: '비밀번호 찾기' })
    expect(router.state.location.pathname).toBe('/password/forgot')
  })

  it('코드를 보낸 주소·남은 시간을 보여 주고, 다시 받기는 60초 뒤에 열린다', async () => {
    await toResetStep()
    expect(screen.getByText('me@example.com')).toBeInTheDocument()
    expect(screen.getByText(/남은 시간 (10:00|09:5\d)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /다시 받기 · \d+초/ })).toBeDisabled()
    // 코드 확인 전에는 새 비밀번호를 입력할 수 없다
    expect(screen.getByLabelText('새 비밀번호')).toBeDisabled()
    expect(screen.getByRole('button', { name: '저장하고 다시 로그인' })).toBeDisabled()
  })

  it('이 기기 시계가 서버보다 늦어도 남은 시간은 규칙(코드 10분, 다시 받기 60초)보다 크게 보이지 않는다', async () => {
    // 시계가 약 10초 늦은 경우: 서버 시각 기준 만료·재요청 시각이 이 기기에서는 609초·69초 뒤로 보인다
    await toResetStep({
      'POST /api/auth/password-reset': () => json(202, { expiresAt: later(609), resendAvailableAt: later(69) }),
    })
    expect(screen.getByText('남은 시간 10:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 받기 · 60초' })).toBeInTheDocument()
  })

  it('틀린 코드는 남은 시도 횟수를 알리고 입력을 비운다', async () => {
    await toResetStep()
    const code = screen.getByRole('textbox', { name: '인증번호' })
    await userEvent.type(code, '111111')
    expect(await screen.findByText('코드가 맞지 않아요(남은 시도 3회)')).toBeInTheDocument()
    expect(code).toHaveValue('')
  })

  it('코드가 만료됐으면 입력을 잠그고 새 코드 받기를 보여 준다', async () => {
    await toResetStep({ 'POST /api/auth/password-reset/verify': () => problem(400, 'CODE_EXPIRED') })
    await userEvent.type(screen.getByRole('textbox', { name: '인증번호' }), '123456')
    expect(await screen.findByText('이 코드는 더 쓸 수 없어요. 새 코드를 받아 주세요')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '인증번호' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /새 코드 받기/ })).toBeInTheDocument()
  })

  it('붙여넣은 코드의 숫자만 쓰고, 맞으면 새 비밀번호를 저장한 뒤 로그인 화면으로 간다', async () => {
    const { router, calls } = await toResetStep()
    const code = screen.getByRole('textbox', { name: '인증번호' })
    await userEvent.click(code)
    await userEvent.paste('123 456')
    expect(await screen.findByText('✓ 확인됐어요')).toBeInTheDocument()

    const password = screen.getByLabelText('새 비밀번호')
    expect(password).toBeEnabled()
    // 코드 칸이 잠기므로 새 비밀번호 칸으로 포커스가 간다(BODY로 빠지지 않게)
    await waitFor(() => expect(password).toHaveFocus())
    await userEvent.type(password, 'newpassword1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'newpassword2')
    await userEvent.click(screen.getByRole('button', { name: '저장하고 다시 로그인' }))
    expect(screen.getByText('비밀번호가 일치하지 않아요')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('새 비밀번호 확인'))
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'newpassword1')
    await userEvent.click(screen.getByRole('button', { name: '저장하고 다시 로그인' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByText('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요')).toBeInTheDocument()
    expect(calls.map((c) => c.url)).toEqual(['request', 'verify', 'confirm'])
    expect(calls[2].body).toEqual({ email: 'me@example.com', code: '123456', newPassword: 'newpassword1' })
  })

  it('UTF-8 72바이트를 넘는 비밀번호는 칸 아래에 알린다', async () => {
    await toResetStep()
    await userEvent.type(screen.getByRole('textbox', { name: '인증번호' }), '123456')
    await screen.findByText('✓ 확인됐어요')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), `a1${'가'.repeat(24)}`)
    expect(screen.getByText('비밀번호가 너무 길어요. 한글은 한 글자가 더 많은 자리를 차지해요.')).toBeInTheDocument()
  })
})

// 미인증 배너(SCR-COM-07)는 업무일지 숨김(2026-10-12, 문안 표 4-12)으로 앱에서 뺐다. 인증 창은 설정 › 계정의 [인증하기]로 연다
describe('이메일 인증 필수 (사용자 지시 2026-10-13)', () => {
  function setup(options: { verified?: boolean; path?: string; signedIn?: boolean } = {}) {
    let me = { ...ME, emailVerified: options.verified ?? false }
    let signedIn = options.signedIn ?? true
    const fetchMock = stubFetch({
      'GET /api/users/me': () => (signedIn ? json(200, me) : problem(401, 'UNAUTHENTICATED')),
      'GET /api/users/me/email-verification': () =>
        json(200, { verified: me.emailVerified, expiresAt: later(420), attemptsRemaining: 5, resendAvailableAt: null }),
      'POST /api/users/me/email-verification': () => json(202, issued()),
      'POST /api/users/me/email-verification/confirm': (init) => {
        if (body(init).code !== '123456') return problem(400, 'CODE_MISMATCH', { attemptsRemaining: 4 })
        me = { ...me, emailVerified: true, version: me.version + 1 }
        return json(200, me)
      },
      'POST /api/auth/logout': () => {
        signedIn = false
        return new Response(null, { status: 204 })
      },
    })
    const { router } = renderApp(options.path ?? '/calendar')
    return { fetchMock, router }
  }

  it('인증하지 않았으면 어떤 앱 화면이든 인증 화면으로 가고, 코드 칸에 포커스가 간다', async () => {
    const { router } = setup({ path: '/settings/account' })
    expect(await screen.findByRole('heading', { level: 1, name: '이메일 인증' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/verify-email')
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).not.toBeInTheDocument()
    expect(await screen.findByText(/남은 시간 0[67]:\d\d/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '인증번호' })).toHaveFocus())
  })

  it('틀린 코드는 남은 시도를 알리고, 맞히면 토스트와 함께 홈으로 간다', async () => {
    const { router } = setup({ path: '/' })
    const code = await screen.findByRole('textbox', { name: '인증번호' })
    await userEvent.type(code, '000000')
    expect(await screen.findByText('코드가 맞지 않아요(남은 시도 4회)')).toBeInTheDocument()
    await userEvent.type(code, '123456')
    expect(await screen.findByText('이메일 인증을 마쳤어요')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument()
  })

  it('다시 받기를 누르면 새 코드를 받고 쿨다운을 보여 준다', async () => {
    const { fetchMock } = setup()
    await screen.findByRole('textbox', { name: '인증번호' })
    await userEvent.click(screen.getByRole('button', { name: '다시 받기' }))
    expect(await screen.findByText('새 코드를 보냈어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /다시 받기 · \d+초/ })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '인증번호' })).toHaveFocus())
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/users/me/email-verification' && init?.method === 'POST',
      ),
    ).toHaveLength(1)
  })

  it('다른 이메일로 가입했으면 로그아웃해 로그인 화면으로 빠져나갈 수 있다', async () => {
    const { router } = setup()
    await screen.findByRole('textbox', { name: '인증번호' })
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('인증을 마친 사용자가 /verify-email로 오면 홈으로, 로그인 안 했으면 로그인으로', async () => {
    const { router } = setup({ verified: true, path: '/verify-email' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    vi.unstubAllGlobals()

    const guest = setup({ signedIn: false, path: '/verify-email' })
    await waitFor(() => expect(guest.router.state.location.pathname).toBe('/login'))
  })

  it('가입 직후 바로 인증 화면으로 간다 (D-64 첫 코드 자동 발송)', async () => {
    stubFetch({
      'GET /api/users/me': () => problem(401, 'UNAUTHENTICATED'),
      'POST /api/auth/signup': () => json(201, { ...ME, emailVerified: false }),
      'GET /api/users/me/email-verification': () =>
        json(200, { verified: false, expiresAt: later(600), attemptsRemaining: 5, resendAvailableAt: later(60) }),
    })
    const { router } = renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('이메일'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'worklog20')
    await userEvent.click(screen.getByRole('checkbox', { name: /전체 동의/ }))
    await userEvent.click(screen.getByRole('button', { name: '회원가입' }))
    expect(await screen.findByRole('heading', { level: 1, name: '이메일 인증' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/verify-email')
  })
})

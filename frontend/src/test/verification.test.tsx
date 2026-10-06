import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('이메일 형식이 아니면 보내지 않는다', async () => {
    const fetchMock = stubFetch({})
    renderApp('/password/forgot')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'not-email')
    await userEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    expect(screen.getByText('이메일 형식이 올바르지 않아요')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/password-reset')).toBe(false)
  })

  it('하루 발송 한도를 넘으면 내일 다시 시도하라고 알린다', async () => {
    stubFetch({ 'POST /api/auth/password-reset': () => problem(429, 'DAILY_SEND_LIMIT', { retryAfterSeconds: 3600 }) })
    renderApp('/password/forgot')
    await userEvent.type(await screen.findByRole('textbox', { name: '이메일' }), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '하루 발송 한도(10통)를 넘었어요. 내일 다시 시도해 주세요',
    )
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

  it('틀린 코드는 남은 시도 횟수를 알리고 입력을 비운다', async () => {
    await toResetStep()
    const code = screen.getByRole('textbox', { name: '인증번호' })
    await userEvent.type(code, '111111')
    expect(await screen.findByText('코드가 맞지 않아요 (남은 시도 3회)')).toBeInTheDocument()
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
    expect(screen.getByText('비밀번호가 너무 길어요. 한글은 한 글자가 더 많은 자리를 차지해요')).toBeInTheDocument()
  })
})

describe('SCR-COM-07 미인증 배너 · SCR-AUTH-08 이메일 인증', () => {
  function setup(options: { verified?: boolean } = {}) {
    let me = { ...ME, emailVerified: options.verified ?? false }
    const fetchMock = stubFetch({
      'GET /api/users/me': () => json(200, me),
      'GET /api/users/me/email-verification': () =>
        json(200, { verified: me.emailVerified, expiresAt: later(420), attemptsRemaining: 5, resendAvailableAt: null }),
      'POST /api/users/me/email-verification': () => json(202, issued()),
      'POST /api/users/me/email-verification/confirm': (init) => {
        if (body(init).code !== '123456') return problem(400, 'CODE_MISMATCH', { attemptsRemaining: 4 })
        me = { ...me, emailVerified: true, version: me.version + 1 }
        return json(200, me)
      },
    })
    renderApp('/')
    return { fetchMock }
  }

  it('인증한 사용자에게는 배너가 없다', async () => {
    setup({ verified: true })
    await screen.findByRole('textbox', { name: '빠른 기록' })
    expect(screen.queryByRole('region', { name: '이메일 인증 안내' })).not.toBeInTheDocument()
  })

  it('닫으면 이번 로그인 동안 숨긴다', async () => {
    setup()
    const banner = await screen.findByRole('region', { name: '이메일 인증 안내' })
    expect(banner).toHaveTextContent('demo@example.com 인증을 마치면 일지를 내보낼 수 있어요')
    await userEvent.click(within(banner).getByRole('button', { name: '이번 로그인 동안 숨기기' }))
    expect(screen.queryByRole('region', { name: '이메일 인증 안내' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('worklog.unverifiedBanner.hiddenFor')).toBe(ME.id)
    // 배너가 사라지면 포커스를 화면 제목으로 옮긴다(BODY로 빠지지 않게)
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('인증하기 → 코드를 맞히면 모달과 배너가 사라지고 토스트로 알린다', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: '인증하기' }))
    const dialog = await screen.findByRole('dialog', { name: '이메일 인증' })
    expect(within(dialog).getByText(/남은 시간 0[67]:\d\d/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '다시 받기' })).toBeEnabled()

    const code = within(dialog).getByRole('textbox', { name: '인증번호' })
    await userEvent.type(code, '000000')
    expect(await within(dialog).findByText('코드가 맞지 않아요 (남은 시도 4회)')).toBeInTheDocument()

    await userEvent.type(code, '123456')
    expect(await screen.findByText('이메일 인증을 마쳤어요')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '이메일 인증 안내' })).not.toBeInTheDocument()
  })

  it('Esc로 모달을 닫으면 인증하기 버튼으로 포커스가 돌아온다', async () => {
    setup()
    const open = await screen.findByRole('button', { name: '인증하기' })
    await userEvent.click(open)
    await screen.findByRole('dialog', { name: '이메일 인증' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(open).toHaveFocus()
  })

  it('다시 받기를 누르면 새 코드를 받고 쿨다운을 보여 준다', async () => {
    const { fetchMock } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '인증하기' }))
    const dialog = await screen.findByRole('dialog', { name: '이메일 인증' })
    await userEvent.click(within(dialog).getByRole('button', { name: '다시 받기' }))
    expect(await within(dialog).findByText('새 코드를 보냈어요')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /다시 받기 · \d+초/ })).toBeDisabled()
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/users/me/email-verification' && init?.method === 'POST',
      ),
    ).toHaveLength(1)
  })
})

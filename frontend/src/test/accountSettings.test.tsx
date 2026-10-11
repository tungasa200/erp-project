// SCR-SET-06 설정 — 계정 (P4-08, POST /api/auth/password-change, D-173)
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Body = { currentPassword: string; newPassword: string }

function server(respond: (body: Body) => Response = () => json(200, { currentSessionKept: true }), me = ME) {
  const bodies: Body[] = []
  let loggedIn = true
  stubFetch({
    'GET /api/users/me': () => (loggedIn ? json(200, me) : problem(401, 'UNAUTHENTICATED')),
    'POST /api/auth/password-change': (init) => {
      const body = JSON.parse(String(init?.body)) as Body
      bodies.push(body)
      return respond(body)
    },
    'POST /api/auth/logout': () => {
      loggedIn = false
      return new Response(null, { status: 204 })
    },
  })
  return { bodies }
}

const current = () => screen.getByLabelText('현재 비밀번호')
const next = () => screen.getByLabelText('새 비밀번호')
const confirm = () => screen.getByLabelText('새 비밀번호 확인')

async function fill(values: { current?: string; next?: string; confirm?: string }) {
  if (values.current) await userEvent.type(current(), values.current)
  if (values.next) await userEvent.type(next(), values.next)
  if (values.confirm) await userEvent.type(confirm(), values.confirm)
}

describe('SCR-SET-06 계정', () => {
  it('설정 메뉴에 계정 탭이 있고 이메일·인증 상태를 보여 준다', async () => {
    server()
    renderApp('/settings/account')
    const section = within((await screen.findByRole('heading', { name: '계정' })).closest('section')!)
    expect(screen.getByRole('link', { name: /계정/ })).toHaveAttribute('aria-current', 'page')
    expect(section.getByText('demo@example.com')).toBeInTheDocument()
    expect(section.getByText(/이메일 미인증/)).toBeInTheDocument()
    expect(section.getByRole('button', { name: '인증하기' })).toBeInTheDocument()
  })

  it('인증한 계정은 인증됨 표시만 있다', async () => {
    server(undefined, { ...ME, emailVerified: true })
    renderApp('/settings/account')
    const section = within((await screen.findByRole('heading', { name: '계정' })).closest('section')!)
    expect(section.getByText('인증됨')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: '인증하기' })).not.toBeInTheDocument()
  })

  it('키보드로 바꾸면 칸을 비우고 토스트, 이 기기는 로그인 유지', async () => {
    const { bodies } = server()
    const { router } = renderApp('/settings/account')
    await userEvent.click(await screen.findByLabelText('현재 비밀번호'))
    await userEvent.keyboard('worklog20')
    await userEvent.tab()
    await userEvent.keyboard('newpassw0rd')
    await userEvent.tab()
    await userEvent.keyboard('newpassw0rd{Enter}')

    expect(await screen.findByText('비밀번호를 바꿨어요. 다른 기기에서는 로그아웃됐어요')).toBeInTheDocument()
    expect(bodies).toEqual([{ currentPassword: 'worklog20', newPassword: 'newpassw0rd' }])
    expect(current()).toHaveValue('')
    expect(next()).toHaveValue('')
    expect(confirm()).toHaveValue('')
    expect(router.state.location.pathname).toBe('/settings/account')
  })

  it('currentSessionKept=false면 로그인 화면으로 가서 다시 로그인하라고 알린다', async () => {
    server(() => json(200, { currentSessionKept: false }))
    const { router } = renderApp('/settings/account')
    await screen.findByLabelText('현재 비밀번호')
    await fill({ current: 'worklog20', next: 'newpassw0rd', confirm: 'newpassw0rd' })
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByText('비밀번호를 바꿨어요. 새 비밀번호로 다시 로그인해 주세요.')).toBeInTheDocument()
  })

  it('보내기 전에 화면에서 확인한다: 빈 칸, 규칙, 지금 것과 같음, 확인 불일치', async () => {
    const { bodies } = server()
    renderApp('/settings/account')
    await screen.findByLabelText('현재 비밀번호')
    const submit = screen.getByRole('button', { name: '비밀번호 변경' })

    await userEvent.click(submit)
    expect(current()).toHaveAccessibleDescription('입력해 주세요')
    expect(current()).toHaveFocus()

    await fill({ current: 'worklog20', next: 'short1' })
    await userEvent.click(submit)
    expect(next()).toHaveAccessibleDescription(/비밀번호 규칙을 확인해 주세요/)
    expect(next()).toHaveFocus()

    await userEvent.clear(next())
    await fill({ next: 'worklog20' })
    await userEvent.click(submit)
    expect(next()).toHaveAccessibleDescription(/지금 쓰는 비밀번호와 다르게 정해 주세요/)

    await userEvent.clear(next())
    await fill({ next: 'newpassw0rd', confirm: 'newpassw0r' })
    // 확인 칸에서 벗어나면 바로 비교한다
    await userEvent.tab()
    expect(confirm()).toHaveAccessibleDescription('새 비밀번호와 같게 입력해 주세요')
    expect(bodies).toHaveLength(0)
  })

  it('72바이트를 넘으면 입력 중에 칸 아래에 알린다', async () => {
    server()
    renderApp('/settings/account')
    await screen.findByLabelText('새 비밀번호')
    await userEvent.type(next(), 'a1' + '가'.repeat(24))
    expect(next()).toHaveAccessibleDescription(/비밀번호가 너무 길어요/)
  })

  it('현재 비밀번호가 틀리면 그 칸 아래에 알리고 포커스를 옮긴다', async () => {
    server(() =>
      problem(400, 'CURRENT_PASSWORD_MISMATCH', {
        errors: [{ field: 'currentPassword', code: 'CURRENT_PASSWORD_MISMATCH' }],
      }),
    )
    renderApp('/settings/account')
    await screen.findByLabelText('현재 비밀번호')
    await fill({ current: 'wrongpass1', next: 'newpassw0rd', confirm: 'newpassw0rd' })
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    await waitFor(() => expect(current()).toHaveAccessibleDescription('현재 비밀번호가 맞지 않아요'))
    expect(current()).toHaveAttribute('aria-invalid', 'true')
    expect(current()).toHaveFocus()
    // 고치기 시작하면 오류를 지운다
    await userEvent.type(current(), 'x')
    expect(current()).not.toHaveAttribute('aria-invalid')
  })

  it('서버의 PASSWORD_SAME_AS_CURRENT는 새 비밀번호 칸 아래에', async () => {
    server(() =>
      problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'newPassword', code: 'PASSWORD_SAME_AS_CURRENT' }] }),
    )
    renderApp('/settings/account')
    await screen.findByLabelText('현재 비밀번호')
    await fill({ current: 'worklog20', next: 'newpassw0rd', confirm: 'newpassw0rd' })
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))
    await waitFor(() => expect(next()).toHaveAccessibleDescription(/지금 쓰는 비밀번호와 다르게 정해 주세요/))
    expect(next()).toHaveFocus()
  })

  it('429 PASSWORD_CHANGE_LOCKED면 띠로 다시 시도할 시각을 알리고 칸·버튼을 끈다', async () => {
    vi.setSystemTime(new Date('2026-10-10T06:27:00Z')) // 서울 15:27
    server(() => problem(429, 'PASSWORD_CHANGE_LOCKED', { retryAfterSeconds: 900 }))
    renderApp('/settings/account')
    await screen.findByLabelText('현재 비밀번호')
    await fill({ current: 'wrongpass1', next: 'newpassw0rd', confirm: 'newpassw0rd' })
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    const band = await screen.findByRole('alert')
    expect(band).toHaveTextContent('15:42 이후에 다시 시도해 주세요')
    expect(band).toHaveFocus()
    expect(current()).toBeDisabled()
    expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeDisabled()
    vi.useRealTimers()
  })

  it('로그아웃하면 로그인 화면으로', async () => {
    server()
    const { router } = renderApp('/settings/account')
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('⑤ 개인정보 처리방침·이용약관 링크', async () => {
    server()
    renderApp('/settings/account')
    const legal = await screen.findByRole('region', { name: '약관·정책' })
    expect(within(legal).getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute('href', '/privacy')
    expect(within(legal).getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms')
  })
})

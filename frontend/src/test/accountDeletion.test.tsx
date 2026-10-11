// SCR-SET-07 회원 탈퇴 (P4-05, POST /api/users/me/deletion, D-176)
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function server(respond: () => Response = () => new Response(null, { status: 204 })) {
  const bodies: unknown[] = []
  let loggedIn = true
  stubFetch({
    'GET /api/users/me': () => (loggedIn ? json(200, ME) : problem(401, 'UNAUTHENTICATED')),
    'POST /api/users/me/deletion': (init) => {
      bodies.push(JSON.parse(String(init?.body)))
      const res = respond()
      if (res.status === 204) loggedIn = false
      return res
    },
  })
  return { bodies }
}

const password = () => screen.getByLabelText('비밀번호')
const submit = () => screen.getByRole('button', { name: /회원 탈퇴|탈퇴 처리 중/ })

describe('SCR-SET-07 회원 탈퇴', () => {
  it('계정 화면의 회원 탈퇴 줄에서 들어가고 ← 계정으로 돌아간다', async () => {
    server()
    const { router } = renderApp('/settings/account')
    await userEvent.click(await screen.findByRole('link', { name: '회원 탈퇴' }))
    expect(router.state.location.pathname).toBe('/settings/account/deletion')
    expect(await screen.findByRole('heading', { level: 1, name: '회원 탈퇴' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '계정' }))
    expect(router.state.location.pathname).toBe('/settings/account')
  })

  it('지워지는 데이터·파기 시간·일지 내려받기 안내를 보여 주고, 비밀번호를 넣어야 버튼이 켜진다', async () => {
    server()
    renderApp('/settings/account/deletion')
    await screen.findByRole('heading', { level: 1, name: '회원 탈퇴' })
    expect(screen.getByText('탈퇴하면 아래 데이터가 모두 삭제되며 되돌릴 수 없습니다')).toBeInTheDocument()
    expect(
      screen.getByText(
        /업무 데이터는 탈퇴 후 보통 1분 안에, 늦어도 20분 안에\(서버 점검 중이었다면 다시 켜진 직후\) 모두 삭제되며/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '일지 목록으로 이동' })).toHaveAttribute('href', '/logs')
    expect(submit()).toBeDisabled()
    await userEvent.type(password(), 'worklog20')
    expect(submit()).toBeEnabled()
  })

  it('키보드로 비밀번호를 넣고 Enter → 확인 창 없이 탈퇴, 로그인 화면에 완료 띠', async () => {
    const { bodies } = server()
    const { router } = renderApp('/settings/account/deletion')
    await userEvent.click(await screen.findByLabelText('비밀번호'))
    await userEvent.keyboard('worklog20{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(bodies).toEqual([{ password: 'worklog20' }])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('회원 탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.')).toBeInTheDocument()
    // 새로 고치면 사라지도록 기록의 state에서는 이유를 지운다
    await waitFor(() => expect((router.state.location.state as { reason?: string }).reason).toBeUndefined())
    expect(screen.getByText(/회원 탈퇴가 완료되었습니다/)).toBeInTheDocument()
    // 띠는 닫을 수 있고, 닫으면 포커스는 이메일 칸으로
    await userEvent.click(screen.getByRole('button', { name: '안내 닫기' }))
    expect(screen.queryByText(/회원 탈퇴가 완료되었습니다/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('이메일')).toHaveFocus()
  })

  it('처리 중에는 버튼 문구가 바뀌고 포커스가 버튼에 남는다', async () => {
    let release: (r: Response) => void = () => {}
    stubFetch({
      'GET /api/users/me': () => json(200, ME),
      'POST /api/users/me/deletion': () => new Promise<Response>((r) => (release = r)),
    })
    renderApp('/settings/account/deletion')
    await userEvent.type(await screen.findByLabelText('비밀번호'), 'worklog20')
    await userEvent.click(submit())
    expect(await screen.findByRole('button', { name: '탈퇴 처리 중…' })).toHaveFocus()
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(password()).toHaveAttribute('readonly')
    release(problem(400, 'PASSWORD_MISMATCH'))
    expect(await screen.findByText('비밀번호가 일치하지 않습니다.')).toBeInTheDocument()
  })

  it('PASSWORD_MISMATCH면 칸을 비우고 칸 아래 오류, 포커스는 비밀번호 칸', async () => {
    server(() => problem(400, 'PASSWORD_MISMATCH', { errors: [{ field: 'password', code: 'PASSWORD_MISMATCH' }] }))
    const { router } = renderApp('/settings/account/deletion')
    await userEvent.type(await screen.findByLabelText('비밀번호'), 'wrongpass1')
    await userEvent.click(submit())

    expect(await screen.findByText('비밀번호가 일치하지 않습니다.')).toBeInTheDocument()
    expect(password()).toHaveValue('')
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('비밀번호가 일치하지 않습니다.')
    expect(password()).toHaveFocus()
    expect(router.state.location.pathname).toBe('/settings/account/deletion')
    // 다시 입력하면 오류가 걷힌다
    await userEvent.keyboard('a')
    expect(screen.queryByText('비밀번호가 일치하지 않습니다.')).not.toBeInTheDocument()
  })

  it('429 PASSWORD_CHANGE_LOCKED면 띠로 다시 시도할 시각을 알리고 칸·버튼을 끈다', async () => {
    vi.setSystemTime(new Date('2026-10-10T06:27:00Z')) // 서울 15:27
    server(() => problem(429, 'PASSWORD_CHANGE_LOCKED', { retryAfterSeconds: 900 }))
    renderApp('/settings/account/deletion')
    await userEvent.type(await screen.findByLabelText('비밀번호'), 'wrongpass1')
    await userEvent.click(submit())

    const band = await screen.findByRole('alert')
    expect(band).toHaveTextContent('비밀번호를 여러 번 잘못 입력하여 잠시 탈퇴할 수 없습니다. 15:42 이후에')
    expect(band).toHaveFocus()
    expect(password()).toBeDisabled()
    expect(submit()).toBeDisabled()
    vi.useRealTimers()
  })
})

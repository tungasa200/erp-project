// REL-09 화면정의서 2.5: 제출 때 오류가 있으면 화면 순서상 첫 오류 칸으로 포커스(가입·로그인)
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SCR-AUTH-03 가입 실패 시 첫 오류 칸으로 포커스', () => {
  it('클라이언트 검증: 이메일이 맞으면 다음 오류 칸(비밀번호 확인)으로, Enter로 내도 같다', async () => {
    stubFetch({})
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'worklog21{Enter}')
    const confirm = screen.getByLabelText('비밀번호 확인')
    await waitFor(() => expect(confirm).toHaveFocus())
    expect(confirm).toHaveAccessibleDescription('비밀번호가 일치하지 않습니다.')
  })

  it('빈 채로 내면 첫 칸(이메일)으로', async () => {
    stubFetch({})
    renderApp('/signup')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '회원가입' }))
    await waitFor(() => expect(screen.getByLabelText('이메일')).toHaveFocus())
  })

  it('동의 오류만 있으면 체크하지 않은 첫 필수 항목으로', async () => {
    stubFetch({})
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'worklog20')
    await user.click(screen.getByLabelText('[필수] 만 14세 이상입니다'))
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    const terms = screen.getByRole('checkbox', { name: /이용약관 동의/ })
    await waitFor(() => expect(terms).toHaveFocus())
    expect(terms).toHaveAccessibleDescription('필수 항목에 모두 동의해야 가입할 수 있습니다.')
    // 체크한 항목은 오류로 읽지 않는다
    expect(screen.getByLabelText('[필수] 만 14세 이상입니다')).not.toHaveAttribute('aria-invalid')
  })

  it('이미 가입된 이메일이면 이메일 칸으로', async () => {
    stubFetch({ 'POST /api/auth/signup': () => problem(409, 'EMAIL_ALREADY_EXISTS') })
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'worklog20')
    await user.click(screen.getByLabelText('전체 동의'))
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    const email = screen.getByLabelText('이메일')
    await waitFor(() => expect(email).toHaveFocus())
    expect(email).toHaveAccessibleDescription(/이미 가입된 이메일입니다/)
  })

  it('서버 errors[]도 화면 순서상 첫 칸으로', async () => {
    stubFetch({
      'POST /api/auth/signup': () =>
        problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'password', code: 'PASSWORD_LENGTH' }] }),
    })
    renderApp('/signup')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'worklog20')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'worklog20')
    await user.click(screen.getByLabelText('전체 동의'))
    await user.click(screen.getByRole('button', { name: '회원가입' }))
    await waitFor(() => expect(screen.getByLabelText('비밀번호')).toHaveFocus())
  })
})

describe('SCR-AUTH-02 로그인 실패 시 첫 오류 칸으로 포커스', () => {
  it('비밀번호만 비었으면 비밀번호 칸으로', async () => {
    stubFetch({})
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com{Enter}')
    const password = screen.getByLabelText('비밀번호')
    await waitFor(() => expect(password).toHaveFocus())
    expect(password).toHaveAccessibleDescription('입력해 주세요')
  })

  it('서버 errors[]면 그 칸으로', async () => {
    stubFetch({
      'POST /api/auth/login': () =>
        problem(400, 'VALIDATION_FAILED', { errors: [{ field: 'email', code: 'EMAIL_INVALID' }] }),
    })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pw')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByLabelText('이메일')).toHaveFocus())
  })

  it('이메일·비밀번호가 틀리면(띠) 포커스를 옮기지 않는다', async () => {
    stubFetch({ 'POST /api/auth/login': () => problem(401, 'INVALID_CREDENTIALS') })
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('이메일'), 'a@b.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pw')
    const submit = screen.getByRole('button', { name: '로그인' })
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 맞지 않아요')
    expect(submit).toHaveFocus()
  })
})

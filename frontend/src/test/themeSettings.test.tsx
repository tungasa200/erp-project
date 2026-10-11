// SCR-SET-04 설정 — 테마 (P4-09). 고르는 동안은 미리보기만, [저장]해야 앱 전체에 적용
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsLayout } from '../settings/SettingsLayout'
import { ThemeSettings } from '../settings/ThemeSettings'
import { json, ME, problem, renderApp, stubFetch } from './renderApp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('style')
})

const ROUTES = [
  { path: '/settings', element: <SettingsLayout />, children: [{ path: 'theme', element: <ThemeSettings /> }] },
]

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)

function setup(patch?: (body: Record<string, unknown>) => Response) {
  const patches: Record<string, unknown>[] = []
  stubFetch({
    'GET /api/users/me': () => json(200, ME),
    'PATCH /api/users/me': (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      patches.push(body)
      if (patch) return patch(body)
      const { version: _, ...fields } = body
      return json(200, { ...ME, ...fields, version: ME.version + 1 })
    },
  })
  renderApp('/settings/theme', ROUTES)
  return { patches, user: userEvent.setup() }
}

describe('SCR-SET-04 테마', () => {
  it('설정 메뉴에 테마 탭이 있고, 지금 테마(보라·쿨 그레이)가 눌린 상태로 보인다', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: '테마' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /테마/ })).toHaveAttribute('href', '/settings/theme')
    expect(screen.getByRole('button', { name: '보라' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '쿨 그레이' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(7 + 3)
    expect(screen.getByRole('button', { name: '다크 (준비 중)' })).toBeDisabled()
  })

  it('키보드로 고르면 미리보기만 바뀌고, [저장]해야 PATCH 후 앱 전체에 적용된다', async () => {
    const { patches, user } = setup()
    await screen.findByRole('heading', { name: '테마' })
    await waitFor(() => expect(rootVar('--color-accent')).toBe('#4B3FD6'))

    screen.getByRole('button', { name: '청록' }).focus()
    await user.keyboard('{Enter}')
    screen.getByRole('button', { name: '세이지' }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: '청록' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '세이지' })).toHaveAttribute('aria-pressed', 'true')
    // 저장 전에는 앱 색이 그대로
    expect(rootVar('--color-accent')).toBe('#4B3FD6')
    expect(patches).toHaveLength(0)

    screen.getByRole('button', { name: '저장' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('저장했어요. 앱 전체에 적용됐어요')).toBeInTheDocument()
    expect(patches).toEqual([{ themeAccent: '#0E8A7E', themeGround: '#EEF4EF', version: ME.version }])
    await waitFor(() => expect(rootVar('--color-accent')).toBe('#0E8A7E'))
    expect(rootVar('--color-ground')).toBe('#EEF4EF')
    expect(screen.getByRole('button', { name: '저장' })).toHaveFocus()
  })

  it('직접 고른 색은 대문자로 저장하고, 밝은 색이면 버튼 글자를 진한 색으로 바꿨다고 알린다', async () => {
    const { patches, user } = setup()
    const input = await screen.findByLabelText('직접 고르기')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    // input[type=color]는 user-event로 고를 수 없어 change 이벤트를 직접 낸다
    fireEvent.change(input, { target: { value: '#ffd84a' } })
    expect(screen.getByText('#FFD84A')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('밝은 색이라 버튼 글자를 진한 색으로 바꿨어요')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1) // 프리셋은 하나도 안 눌림, 배경만

    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(patches[0]).toMatchObject({ themeAccent: '#FFD84A' }))
    await waitFor(() => expect(rootVar('--color-on-accent')).toBe('#1A1C2B'))
  })

  it('[기본값으로]는 보라·쿨 그레이로 되돌린다(저장 전까지 미리보기만)', async () => {
    const { patches, user } = setup()
    await user.click(await screen.findByRole('button', { name: '빨강' }))
    await user.click(screen.getByRole('button', { name: '화이트' }))
    await user.click(screen.getByRole('button', { name: '기본값으로' }))
    expect(screen.getByRole('button', { name: '보라' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '쿨 그레이' })).toHaveAttribute('aria-pressed', 'true')
    expect(patches).toHaveLength(0)
  })

  it('저장이 실패하면 고른 값을 두고 오류와 다시 시도를 보여 준다', async () => {
    const { patches, user } = setup(() => problem(500, 'INTERNAL_ERROR'))
    await user.click(await screen.findByRole('button', { name: '초록' }))
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요')
    expect(screen.getByRole('button', { name: '초록' })).toHaveAttribute('aria-pressed', 'true')
    expect(rootVar('--color-accent')).toBe('#4B3FD6')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(patches).toHaveLength(2))
  })

  it('다른 곳에서 먼저 고쳤으면(409) 충돌 띠를 띄운다', async () => {
    const { user } = setup(() => problem(409, 'VERSION_CONFLICT'))
    await user.click(await screen.findByRole('button', { name: '저장' }))
    expect(await screen.findByText(/다른 곳에서 먼저 수정됐어요/)).toBeInTheDocument()
  })
})

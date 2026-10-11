import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LandingPage } from './LandingPage'

function setup() {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )
}

describe('LandingPage (SCR-AUTH-01)', () => {
  it('핵심 문구와 세 단계', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('따로 기록하지 않아도일지가 써집니다')
    const steps = within(screen.getByRole('region', { name: '하루가 일지가 되는 세 단계' })).getAllByRole('listitem')
    expect(steps.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      '한 줄로 계획',
      '끝나면 확인 한 번',
      '일지는 이미 완성',
    ])
  })

  it('가입·로그인으로 보낸다', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: '계정' })
    expect(within(nav).getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
    expect(within(nav).getByRole('link', { name: '무료로 시작하기' })).toHaveAttribute('href', '/signup')
    for (const link of screen.getAllByRole('link', { name: /시작하기/ }))
      expect(link).toHaveAttribute('href', '/signup')
  })

  it('바닥글에 약관·처리방침, 앱 이름은 WY Worklog(D-182)', () => {
    setup()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms')
    expect(within(footer).getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute('href', '/privacy')
    expect(footer).toHaveTextContent('© WY Worklog')
  })

  it('화면 그림은 보조기술에서 읽지 않는다', () => {
    setup()
    expect(screen.queryByText('고객사 미팅 · 했나요?')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

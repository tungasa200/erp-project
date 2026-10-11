import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PrivacyPage } from './PrivacyPage'
import { TermsPage } from './TermsPage'

function setup(page: React.ReactNode) {
  render(<MemoryRouter>{page}</MemoryRouter>)
}

describe('SCR-AUTH-06 처리방침 · SCR-AUTH-07 이용약관', () => {
  it('처리방침: 목차가 절마다 같은 화면 안으로 보내고, 국외 이전 표는 가로로 밀 수 있다', () => {
    setup(<PrivacyPage />)
    expect(screen.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeInTheDocument()
    const toc = within(screen.getByRole('navigation', { name: '목차' })).getAllByRole('link')
    const sections = screen.getAllByRole('heading', { level: 2 })
    expect(toc).toHaveLength(10)
    expect(toc.map((a) => a.textContent)).toEqual(sections.map((h) => h.textContent))
    toc.forEach((a) => expect(document.querySelector(a.getAttribute('href')!)).not.toBeNull())
    const box = screen.getByRole('region', { name: '3. 개인정보의 국외 이전(처리 위탁·보관) 표' })
    expect(box).toHaveAttribute('tabindex', '0')
    expect(within(box).getByRole('cell', { name: 'Railway Corp.' })).toBeInTheDocument()
  })

  it('정해지지 않은 자리는 [확정 전]으로 표시하고 원문의 작업 메모는 보이지 않는다', () => {
    setup(<PrivacyPage />)
    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0)
    document.querySelectorAll('mark').forEach((m) => expect(m).toHaveTextContent('[확정 전]'))
    expect(document.body).not.toHaveTextContent(/빈칸|D-\d|WY-|docs\//)
  })

  it('이용약관: 12개 조와 부칙, 머리의 로고는 처음 화면으로', () => {
    setup(<TermsPage />)
    expect(screen.getByRole('heading', { level: 1, name: '이용약관' })).toBeInTheDocument()
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles[0]).toBe('제1조 (목적)')
    expect(titles.at(-1)).toBe('부칙')
    expect(titles).toHaveLength(13)
    expect(screen.getByRole('link', { name: /처음 화면으로/ })).toHaveAttribute('href', '/')
    expect(screen.getByText(/초안 ·/)).toHaveTextContent('시행일: [확정 전]')
  })
})

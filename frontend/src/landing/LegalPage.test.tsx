import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    // 연락처 칸(REL-01 3차): 메일은 글자, 문의 양식 주소는 새 탭 링크
    expect(
      within(box)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)[1],
    ).toBe('연락처')
    expect(within(box).getByRole('cell', { name: 'privacy@railway.com' })).toBeInTheDocument()
    const links = within(box).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://support.google.com/policies/contact/data_privacy_office',
      'https://support.google.com/policies/contact/data_privacy_office',
      'https://www.apple.com/legal/privacy/contact/',
      'https://go.microsoft.com/fwlink/?linkid=2126612',
    ])
    links.forEach((a) => {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
      expect(a).toHaveAccessibleName(/새 탭에서 열림/)
    })
  })

  it('목차로 장을 옮기면 읽기 위치(포커스)가 그 장 제목으로, 장 끝 [목차로 돌아가기]는 목차로 (UX-AUTH-84)', async () => {
    setup(<PrivacyPage />)
    const toc = screen.getByRole('navigation', { name: '목차' })
    const target = within(toc).getAllByRole('link')[2]
    fireEvent.click(target)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: target.textContent! })),
    )
    const section = screen.getByRole('region', { name: target.textContent! })
    const back = within(section).getByRole('link', { name: '목차로 돌아가기' })
    expect(back).toHaveAttribute('href', '#legal-toc')
    fireEvent.click(back)
    await waitFor(() => expect(document.activeElement).toBe(toc))
    expect(screen.getAllByRole('link', { name: '목차로 돌아가기' })).toHaveLength(10)
  })

  it('정해지지 않은 자리는 [확정 전]으로 표시하고 원문의 작업 메모는 보이지 않는다', () => {
    setup(<PrivacyPage />)
    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0)
    document.querySelectorAll('mark').forEach((m) => expect(m).toHaveTextContent('[확정 전]'))
    expect(document.body).not.toHaveTextContent(/빈칸|D-\d|WY-|docs\//)
    expect(document.body).not.toHaveTextContent('초안')
    // 개정(프로필 탭 숨김, 사용자 결정 2026-10-12) 날짜는 PR #20 병합일(D-215): 머리 시행일도 개정 시행일을 따른다
    expect(document.querySelector('main > p')).toHaveTextContent('시행일: 2026-10-13')
    expect(
      within(screen.getByRole('region', { name: '10. 방침의 변경' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '제정 공고일: 2026-10-12 / 제정 시행일: 2026-10-12',
      '개정 공고일: 2026-10-13 / 개정 시행일: 2026-10-13',
    ])
    expect(document.body).not.toHaveTextContent(/업무일지 머리글|설정 화면에서 프로필/)
  })

  it('이용약관: 12개 조와 부칙, 머리의 로고는 처음 화면으로', () => {
    setup(<TermsPage />)
    expect(screen.getByRole('heading', { level: 1, name: '이용약관' })).toBeInTheDocument()
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles[0]).toBe('제1조 (목적)')
    expect(titles.at(-1)).toBe('부칙')
    expect(titles).toHaveLength(13)
    expect(screen.getByRole('link', { name: /처음 화면으로/ })).toHaveAttribute('href', '/')
    // 제정 공고일·시행일은 출시일(D-199), 개정(D-214 업무일지 숨김)은 PR #20 병합일(D-215). 머리에는 초안 표시 없이 가장 나중 시행일만
    expect(document.body).not.toHaveTextContent('초안')
    expect(document.querySelector('main > p')).toHaveTextContent('시행일: 2026-10-13')
    const appendix = screen.getByRole('region', { name: '부칙' })
    expect(
      within(appendix)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '제정 공고일: 2026-10-12 / 제정 시행일: 2026-10-12',
      '개정 공고일: 2026-10-13 / 개정 시행일: 2026-10-13',
    ])
    // 이용 제한(제8조)은 통지·소명 절차까지 4개 항. 남은 빈칸은 문의 메일(값 없는 빌드)뿐
    expect(within(screen.getByRole('region', { name: '제8조 (이용 제한)' })).getAllByRole('listitem')).toHaveLength(4)
    expect(document.querySelectorAll('main mark')).toHaveLength(1)
    // 업무일지 숨김(D-214): 내보내기로 보관한다는 항은 없앤다
    expect(document.body).not.toHaveTextContent(/내보내 보관|내보내기로 따로|탈퇴 전에 내보내야/)
    expect(within(screen.getByRole('region', { name: '제5조 (회원의 데이터)' })).getAllByRole('listitem')).toHaveLength(
      2,
    )
  })

  describe('운영자·문의 메일(REL-01)', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    async function load(email: string) {
      vi.stubEnv('VITE_CONTACT_EMAIL', email)
      vi.resetModules()
      return { ...(await import('./PrivacyPage')), ...(await import('./TermsPage')) }
    }

    it('문의 메일은 빌드 환경변수에서 읽어 처리방침 연락처·약관 제12조에 보인다', async () => {
      const { PrivacyPage: Privacy, TermsPage: Terms } = await load('contact@example.com')
      setup(<Privacy />)
      expect(screen.getByText('개인정보 보호책임자: 김성우')).toBeInTheDocument()
      const mail = within(screen.getByText(/^연락처:/)).getByRole('link', { name: 'contact@example.com' })
      expect(mail).toHaveAttribute('href', 'mailto:contact@example.com')
      expect(mail).not.toHaveAttribute('target')
      expect(document.body).toHaveTextContent('김성우(이하 "운영자")는')
      document.body.innerHTML = ''
      setup(<Terms />)
      const q = screen.getByRole('region', { name: '제12조 (문의)' })
      // com은 '컴'으로 읽혀 받침이 있으므로 '으로'
      expect(q).toHaveTextContent('서비스 이용에 관한 문의는 contact@example.com으로 할 수 있습니다.')
      expect(within(q).getByRole('link', { name: 'contact@example.com' })).toHaveAttribute(
        'href',
        'mailto:contact@example.com',
      )
      expect(within(q).queryByText('[확정 전]')).toBeNull()
    })

    it.each([
      ['help@example.kr', '로'],
      ['help@example.io', '로'],
      ['help@example.net', '으로'],
      ['help@example.test', '(으)로'],
    ])('제12조 조사는 주소 끝을 읽는 소리로: %s → %s', async (email, ro) => {
      const { TermsPage: Terms } = await load(email)
      setup(<Terms />)
      expect(screen.getByRole('region', { name: '제12조 (문의)' })).toHaveTextContent(
        `문의는 ${email}${ro} 할 수 있습니다.`,
      )
    })

    it('값이 없는 빌드(로컬·미리보기)에서는 문의 메일 자리를 [확정 전]으로 남긴다', async () => {
      const { PrivacyPage: Privacy } = await load('  ')
      setup(<Privacy />)
      expect(screen.getByText('연락처:', { exact: false })).toHaveTextContent('연락처: [확정 전]')
      expect(screen.queryByRole('link', { name: /@/ })).toBeNull()
    })
  })
})

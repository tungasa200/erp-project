// 로그인·가입·비밀번호 찾기·재설정 공통 틀: 왼쪽 키 컬러 소개 영역 + 오른쪽 폼 (목업 AUTH-02, AUTH-03)
// 문구가 없어도 키 컬러 면은 늘 그린다: 세 진입 화면의 모양을 같게(사용자 지시 2026-10-12)
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { MANUAL_LINK_LABEL, MANUAL_URL } from '../../components/manual'
import { useOnline } from '../../components/useOnline'
import styles from './auth.module.css'

export function AuthLayout({
  heading,
  description,
  children,
}: {
  heading?: ReactNode
  description?: string
  children: ReactNode
}) {
  const online = useOnline()
  return (
    <div className={styles.page}>
      <aside className={styles.intro}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          <span className={styles.brandName}>worklog</span>
        </div>
        {/* 비밀번호 찾기·재설정은 문구 없이 브랜드만 */}
        {heading && <p className={styles.introHeading}>{heading}</p>}
        {description && <p className={styles.introText}>{description}</p>}
      </aside>
      <main className={styles.main}>
        {/* 끊긴 동안에는 제출해도 서버 오류처럼 보이므로 입력을 막는다 (SCR-SYS-02 ③) */}
        <fieldset className={styles.formArea} disabled={!online}>
          {children}
        </fieldset>
        {/* 첫 화면이 로그인이라 처리방침은 여기서 바로 보여야 한다(개인정보 보호법, 랜딩 폐기 2026-10-12). 처리방침은 굵게 */}
        <nav className={styles.legal} aria-label="약관">
          <a href={MANUAL_URL} target="_blank" rel="noopener" aria-label={MANUAL_LINK_LABEL}>
            사용 설명서 <span aria-hidden="true">↗</span>
          </a>
          <Link to="/terms">이용약관</Link>
          <Link to="/privacy" className={styles.legalStrong}>
            개인정보 처리방침
          </Link>
        </nav>
      </main>
    </div>
  )
}

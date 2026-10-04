// 로그인·가입 공통 틀: 왼쪽 키 컬러 소개 영역 + 오른쪽 폼 (목업 AUTH-02, AUTH-03)
import type { ReactNode } from 'react'
import { useOnline } from '../../components/useOnline'
import styles from './auth.module.css'

export function AuthLayout({
  heading,
  description,
  children,
}: {
  heading: ReactNode
  description: string
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
        <p className={styles.introHeading}>{heading}</p>
        <p className={styles.introText}>{description}</p>
      </aside>
      <main className={styles.main}>
        {/* 끊긴 동안에는 제출해도 서버 오류처럼 보이므로 입력을 막는다 (SCR-SYS-02 ③) */}
        <fieldset className={styles.formArea} disabled={!online}>
          {children}
        </fieldset>
      </main>
    </div>
  )
}

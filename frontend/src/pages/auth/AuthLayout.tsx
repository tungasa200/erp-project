// 로그인·가입 공통 틀: 왼쪽 키 컬러 소개 영역 + 오른쪽 폼 (목업 AUTH-02, AUTH-03)
import type { ReactNode } from 'react'
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
      <main className={styles.main}>{children}</main>
    </div>
  )
}

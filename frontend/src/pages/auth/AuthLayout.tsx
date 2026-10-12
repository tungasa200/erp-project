// 로그인·가입 공통 틀: 왼쪽 키 컬러 소개 영역 + 오른쪽 폼 (목업 AUTH-02, AUTH-03)
import type { ReactNode } from 'react'
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
  // 소개 문구가 없으면 키 컬러 면을 빼고 브랜드만 폼 위에 둔다(비밀번호 화면과 같은 모양)
  const bare = !heading && !description
  return (
    <div className={bare ? `${styles.page} ${styles.pageBare}` : styles.page}>
      <aside className={bare ? `${styles.intro} ${styles.introBare}` : styles.intro}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          <span className={styles.brandName}>worklog</span>
        </div>
        {/* 로그인은 소개 문구 없이 브랜드만 둔다(사용자 지시 2026-10-12) */}
        {heading && <p className={styles.introHeading}>{heading}</p>}
        {description && <p className={styles.introText}>{description}</p>}
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

// 비밀번호 찾기·재설정 공통 틀: 가운데 카드 하나 (목업 AUTH-04, AUTH-05)
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useOnline } from '../../components/useOnline'
import styles from './password.module.css'

export function PasswordLayout({ children }: { children: ReactNode }) {
  const online = useOnline()
  return (
    <div className={styles.page}>
      <Link to="/login" className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          w
        </span>
        <span className={styles.brandName}>worklog</span>
      </Link>
      <main className={styles.main}>
        {/* 끊긴 동안에는 입력을 막는다 (SCR-SYS-02 ③) */}
        <fieldset className={styles.card} disabled={!online}>
          {children}
        </fieldset>
      </main>
    </div>
  )
}

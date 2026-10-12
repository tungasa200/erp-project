// SCR-SYS-01 찾을 수 없음(404)
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import styles from './system.module.css'

export function NotFoundPage() {
  const { user } = useAuth()
  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <div className={styles.bigCode} aria-hidden="true">
          404
        </div>
        <h1 className={styles.title}>페이지를 찾을 수 없어요</h1>
        <p className={styles.text}>
          주소가 바뀌었거나 보관된 항목일 수 있어요. 보관한 업무는 보관함에서 찾을 수 있어요.
        </p>
        <div className={styles.actions}>
          <Link to="/" className={styles.primary}>
            홈으로
          </Link>
          {/* 문구가 말하는 보관함으로 가는 길(SYS-01). 404는 내 정보를 조회하지 않으므로(D-189) 앱 안에서 넘어와 이미 아는 사용자일 때만 보인다 */}
          {user && (
            <Link to="/tasks/archive" className={styles.secondary}>
              보관함
            </Link>
          )}
        </div>
      </div>
    </main>
  )
}

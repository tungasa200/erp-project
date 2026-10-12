// SCR-SYS-01 찾을 수 없음(404)
import { Link } from 'react-router'
import styles from './system.module.css'

export function NotFoundPage() {
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
          {/* 문구가 말하는 보관함으로 가는 길(SYS-01). 로그인 여부와 무관하게 늘 둔다: 404는 내 정보를 조회하지 않고(D-189),
              로그인 안 된 사용자는 RequireAuth가 로그인 뒤 보관함으로 돌려보낸다(UX-SYS-171) */}
          <Link to="/tasks/archive" className={styles.secondary}>
            보관함
          </Link>
        </div>
      </div>
    </main>
  )
}

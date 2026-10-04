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
        {/* 보관함 버튼은 보관함 화면(SCR-TASK-04, P4-10)이 생기면 추가 */}
        <div className={styles.actions}>
          <Link to="/" className={styles.primary}>
            홈으로
          </Link>
        </div>
      </div>
    </main>
  )
}

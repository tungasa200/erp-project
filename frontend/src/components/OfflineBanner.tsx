// SCR-SYS-02 ③ 오프라인 상단 띠. 로그인 전 화면을 포함해 앱 전체에 띄운다(라우터 바깥).
import styles from './OfflineBanner.module.css'
import { useOnline } from './useOnline'

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className={styles.offline}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.message}>
        연결이 끊겼어요<span className={styles.detail}>. 다시 연결되면 입력할 수 있어요</span>
      </span>
      <span className={styles.retrying}>재시도 중…</span>
    </div>
  )
}

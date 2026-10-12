// SCR-SYS-02 ② 점검 안내 페이지. 라우터 대신 그려진다(MaintenanceGate)
import { clock } from '../format/datetime'
import styles from './system.module.css'

/** timeZone: 사용자 시간대. 로그인 전이면 브라우저 시간대(SYS-02) */
export function MaintenancePage({ retryAt, timeZone }: { retryAt: Date | null; timeZone: string }) {
  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <span className={`${styles.icon} ${styles.iconInfo}`} aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
          </svg>
        </span>
        <h1 className={styles.title}>서비스 점검 중이에요</h1>
        <p className={styles.text}>
          {retryAt ? `${clock(retryAt, timeZone)} 이후 다시 이용할 수 있어요.` : '지금은 이용할 수 없어요.'} 기록은
          안전하게 보관돼 있어요.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            다시 확인
          </button>
        </div>
        {/* 점검 중에도 약관·처리방침은 열린다(D-177 ②). 라우터 밖에서 그려지므로 <Link> 대신 <a> */}
        <nav className={styles.legal} aria-label="약관">
          <a href="/terms">이용약관</a>
          <a href="/privacy">개인정보 처리방침</a>
        </nav>
      </div>
    </main>
  )
}

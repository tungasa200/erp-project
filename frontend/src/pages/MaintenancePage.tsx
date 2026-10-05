// SCR-SYS-02 ② 점검 안내 페이지
import styles from './system.module.css'

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function MaintenancePage({ retryAt }: { retryAt: Date | null }) {
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
          {retryAt ? `${formatTime(retryAt)} 이후 다시 이용할 수 있어요.` : '지금은 이용할 수 없어요.'} 기록은 안전하게
          보관돼 있어요.
        </p>
      </div>
    </main>
  )
}

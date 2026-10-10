// SCR-COM-05 ③ 모바일 전체 화면 알림(/notifications). 데스크톱에서 주소로 들어와도 같은 목록을 보여 준다.
import { useNavigate } from 'react-router'
import { NotificationList } from './NotificationList'
import styles from './notifications.module.css'

export function NotificationsPage() {
  const navigate = useNavigate()
  return (
    <section aria-labelledby="notifications-h" tabIndex={-1} className={styles.page}>
      <NotificationList
        heading={(actions) => (
          <div className={styles.pageHead}>
            <button
              type="button"
              className={styles.back}
              aria-label="뒤로"
              // 알림에서 바로 들어온 경우(새 탭·푸시) 돌아갈 곳이 없으면 홈으로
              onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))}
            >
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 id="notifications-h" className={styles.pageTitle}>
              알림
            </h1>
            {actions}
          </div>
        )}
      />
    </section>
  )
}

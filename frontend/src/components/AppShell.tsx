// SCR-COM-01 앱 셸 (P0 골격). 알림(SCR-COM-05)·타이머(SCR-COM-06)·프로젝트 목록·빠른 기록은 이후 단계에서 채운다.
import { useSyncExternalStore } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/useAuth'
import styles from './AppShell.module.css'

const MENU = [
  { to: '/', label: '홈', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  {
    to: '/calendar',
    label: '캘린더',
    icon: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  },
  {
    to: '/tasks',
    label: '업무',
    icon: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 12l3 3 5-6',
  },
  {
    to: '/logs',
    label: '업무일지',
    icon: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  },
  { to: '/stats', label: '통계', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
]
const SETTINGS_ICON =
  'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1'

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem} ${styles.active}` : styles.navItem

export function AppShell() {
  const { user } = useAuth()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="주 메뉴">
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          <span className={styles.brandName}>worklog</span>
        </div>
        <div className={styles.profile}>
          <span className={styles.avatar} aria-hidden="true">
            {(user?.name ?? '나').slice(0, 1)}
          </span>
          <span className={styles.profileText}>
            <span className={styles.profileName}>{user?.name ?? user?.email}</span>
            {user?.organization && <span className={styles.profileOrg}>{user.organization}</span>}
          </span>
        </div>
        {MENU.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navClass} title={item.label}>
            <Icon d={item.icon} />
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}
        <div className={styles.spacer} />
        <NavLink to="/settings" className={navClass} title="설정">
          <Icon d={SETTINGS_ICON} />
          <span className={styles.navLabel}>설정</span>
        </NavLink>
      </nav>

      <div className={styles.content}>
        {!online && (
          <div role="status" className={styles.offline}>
            <span className={styles.offlineDot} aria-hidden="true" />
            연결이 끊겼어요. 다시 연결되면 입력할 수 있어요
          </div>
        )}
        {/* 끊긴 동안에는 입력을 막는다 (SCR-SYS-02 ③, 오프라인 기록은 범위 밖) */}
        <fieldset className={styles.main} disabled={!online}>
          <Outlet />
        </fieldset>
      </div>

      {/* 모바일 하단 탭. 빠른 기록(SCR-MOB-01)과 더보기 메뉴는 P1에서 연결한다. */}
      <nav className={styles.tabs} aria-label="하단 탭">
        <NavLink to="/" end className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}>
          홈
        </NavLink>
        <NavLink
          to="/calendar"
          className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
        >
          캘린더
        </NavLink>
        <button type="button" className={styles.quick} aria-label="빠른 기록">
          <Icon d="M12 5v14M5 12h14" size={24} />
        </button>
        <NavLink to="/logs" className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}>
          일지
        </NavLink>
        <button type="button" className={styles.tab}>
          더보기
        </button>
      </nav>
    </div>
  )
}

// 설정 화면 틀: 데스크톱은 좌측 탭, 모바일은 목록 → 상세 (SCR-SET-01 비고).
// 탭은 만든 화면만 둔다. 기록 옵션·테마·알림·계정은 해당 단계에서 더한다.
import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useMatch } from 'react-router'
import { useOnline } from '../components/useOnline'
import styles from './settings.module.css'

const TABS = [
  { to: 'profile', label: '프로필' },
  { to: 'general', label: '일반' },
  { to: 'projects', label: '프로젝트·태그' },
]

const MOBILE_QUERY = '(max-width: 767px)'

function isMobile(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches
}

export function SettingsLayout() {
  const atIndex = useMatch('/settings') !== null
  const online = useOnline()

  return (
    <div className={atIndex ? `${styles.layout} ${styles.atIndex}` : styles.layout}>
      <h1 className={styles.title}>설정</h1>
      <div className={styles.body}>
        <nav aria-label="설정 메뉴" className={styles.nav}>
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
            >
              {t.label}
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.detail}>
          <Link to="/settings" className={styles.back}>
            ‹ 설정
          </Link>
          {/* 설정 화면은 모두 편집이라 끊긴 동안 통째로 막는다(SCR-SYS-02 ③). 탭 이동은 그대로 */}
          <fieldset className={styles.guard} disabled={!online}>
            <Outlet />
          </fieldset>
        </div>
      </div>
    </div>
  )
}

/** /settings: 모바일은 탭 목록만, 데스크톱은 첫 탭을 바로 연다 */
export function SettingsIndex() {
  const [mobile] = useState(isMobile)
  return mobile ? null : <Navigate to="profile" replace />
}

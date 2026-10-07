// SCR-COM-01 앱 셸 (P0 골격). 알림(SCR-COM-05)·타이머(SCR-COM-06)·프로젝트 목록·빠른 기록은 이후 단계에서 채운다.
// 명령 팔레트(Ctrl+K)와 빠른 입력 단축키(N)는 앱 화면 어디서든 동작한다 (P1-10).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { CommandPalette } from '../palette/CommandPalette'
import { useProjects } from '../projects/api'
import { projectColor } from '../projects/palette'
import { useSingleKeyShortcuts } from '../shortcuts/useShortcuts'
import { UnverifiedBanner } from '../verification/UnverifiedBanner'
import styles from './AppShell.module.css'
import { useFocusRescue } from './focusRescue'
import { useOnline } from './useOnline'

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

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem} ${styles.active}` : styles.navItem

export function AppShell() {
  const { user } = useAuth()
  const online = useOnline()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // 지금 화면에 빠른 입력창이 있으면 거기로, 없으면 홈의 입력창으로 간다.
  const quickAdd = useCallback(
    (text?: string) => {
      const input = document.querySelector<HTMLInputElement>('[data-quick-input]')
      if (input && text === undefined) input.focus()
      else navigate('/', { state: { quickText: text, focusQuick: true } })
    },
    [navigate],
  )
  // 닫으면 열기 전 포커스로 돌려준다. 팔레트 effect cleanup에서 돌려주면 개발 모드(StrictMode)에서
  // effect가 두 번 돌 때 열자마자 포커스를 빼앗기므로 여는 쪽에서 기억한다.
  const lastFocus = useRef<Element | null>(null)
  const openPalette = useCallback(() => {
    lastFocus.current = document.activeElement
    setPaletteOpen(true)
  }, [])
  const closePalette = useCallback(() => {
    setPaletteOpen(false)
    if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus()
    lastFocus.current = null
  }, [])

  // 끊긴 동안에는 기록할 수 없으니 N도 막는다(SCR-SYS-02 ③)
  useSingleKeyShortcuts({ KeyN: () => online && quickAdd() })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyK') return
      e.preventDefault()
      if (paletteOpen) closePalette()
      else openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, openPalette, closePalette])

  const { pathname } = useLocation()

  // 누른 요소가 사라져 포커스가 body로 빠지면 이웃·화면 제목으로 되살린다(마지막 안전망, 화면별 처리가 우선)
  const contentRef = useRef<HTMLDivElement>(null)
  useFocusRescue(contentRef)

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="주 메뉴">
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          <span className={styles.brandName}>worklog</span>
        </div>
        {/* 프로필 영역을 누르면 프로필 설정으로 (SCR-SET-01 진입 경로) */}
        <Link to="/settings/profile" className={styles.profile} title="프로필 설정">
          <span className={styles.avatar} aria-hidden="true">
            {(user?.name ?? '나').slice(0, 1)}
          </span>
          <span className={styles.profileText}>
            <span className={styles.profileName}>{user?.name ?? user?.email}</span>
            {user?.organization && <span className={styles.profileOrg}>{user.organization}</span>}
          </span>
        </Link>
        {MENU.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navClass} title={item.label}>
            <Icon d={item.icon} />
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}
        <SidebarProjects />
        <div className={styles.spacer} />
        <NavLink to="/settings" className={navClass} title="설정">
          <Icon d={SETTINGS_ICON} />
          <span className={styles.navLabel}>설정</span>
        </NavLink>
      </nav>

      <div ref={contentRef} className={styles.content}>
        <UnverifiedBanner />
        {/* 끊긴 동안에는 화면마다 저장·편집 영역만 막는다(SCR-SYS-02 ③, 오프라인 기록은 범위 밖). 이동·열람은 된다 */}
        <div className={styles.main}>
          <Outlet />
        </div>
      </div>

      {/* 모바일 하단 탭. 빠른 기록 바텀시트(SCR-MOB-01)는 P4라 P1에서는 + 가 홈 빠른 입력칸으로 보낸다(P1-X-01) */}
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
        <button
          type="button"
          className={styles.quick}
          aria-label="빠른 기록"
          onClick={() => {
            const input = document.querySelector<HTMLInputElement>('[data-quick-input]')
            if (pathname === '/' && input) input.focus()
            else navigate('/', { state: { focusQuick: true } })
          }}
        >
          <Icon d="M12 5v14M5 12h14" size={24} />
        </button>
        <NavLink to="/logs" className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}>
          일지
        </NavLink>
        <MoreMenu />
      </nav>

      {paletteOpen && <CommandPalette onClose={closePalette} onQuickAdd={quickAdd} />}
    </div>
  )
}

// SCR-COM-01 ⑤ 하단 탭 '더보기' (P1-X-01). P1에 있는 화면(업무, 설정)만 담는다.
// 열면 첫 항목으로, Esc·바깥 누르기·항목 선택으로 닫히면 더보기 버튼으로 포커스를 돌려준다.
const MORE = [
  { to: '/tasks', label: '업무' },
  { to: '/settings', label: '설정' },
]

function MoreMenu() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  const here = MORE.some((m) => pathname.startsWith(m.to))

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLElement>('a')?.focus()
    // 바깥을 누르면 닫는다(누른 곳에 포커스를 둔다)
    const onPointerDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={wrap}
      className={styles.more}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={here ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        더보기
      </button>
      {open && (
        <ul id={id} className={styles.moreMenu} aria-label="더보기 메뉴">
          {MORE.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className={styles.moreItem} onClick={() => close()}>
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// SCR-COM-01 ① 사이드바 프로젝트 목록(보관하지 않은 것). 누르면 그 프로젝트로 거른 업무 목록으로 간다.
function SidebarProjects() {
  const { data } = useProjects()
  const projects = data?.filter((p) => !p.archived) ?? []
  if (projects.length === 0) return null
  return (
    <div className={styles.projects}>
      <p className={styles.projectsTitle}>프로젝트</p>
      {projects.map((p) => (
        // NavLink는 쿼리를 보지 않아 /tasks에서 모든 항목이 현재 페이지로 읽히므로 Link를 쓴다
        <Link
          key={p.id}
          to={`/tasks?project=${p.id}`}
          className={styles.projectItem}
          aria-label={`${p.name}, 남은 업무 ${p.openTaskCount}개`}
        >
          <span className={styles.projectDot} style={{ background: projectColor(p.color).base }} aria-hidden="true" />
          <span className={styles.projectName} title={p.name}>
            {p.name}
          </span>
          <span className={styles.projectCount} aria-hidden="true">
            {p.openTaskCount}
          </span>
        </Link>
      ))}
    </div>
  )
}

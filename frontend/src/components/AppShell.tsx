// SCR-COM-01 앱 셸 (P0 골격). 알림(SCR-COM-05)은 P4-01에서 채운다.
// 모바일 하단 탭 가운데 +와 PWA 바로가기 '빠른 기록'(/?quick=1)은 빠른 기록 바텀시트(SCR-MOB-01, P4-03)를 연다.
// 명령 팔레트(Ctrl+K)와 빠른 입력 단축키(N)는 앱 화면 어디서든 동작한다 (P1-10).
// 타이머 미니 플레이어(SCR-COM-06, P2-06)는 사이드바 하단과 모바일 하단 탭 위에 하나씩 달고 CSS로 한쪽만 보인다.
// 팔레트의 '하루 마감'(SCR-LOG-03)은 어느 화면에서든 오늘 마감을 연다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { useAuth } from '../auth/useAuth'
import { DayClose } from '../logs/DayClose'
import { CommandPalette } from '../palette/CommandPalette'
import { useProjects } from '../projects/api'
import { PendingPanel } from '../records/PendingPanel'
import { todayIn } from '../quickInput/dates'
import { projectColor } from '../projects/palette'
import { useSingleKeyShortcuts } from '../shortcuts/useShortcuts'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { CompletionResultHost } from '../tasks/CompletionResult'
import { stoppedMessage, useRunningTimer, useTimerCommands } from '../timer/api'
import { TimerMiniPlayer } from '../timer/TimerMiniPlayer'
import { TimerStartDialog } from '../timer/TimerStartDialog'
import { UnverifiedBanner } from '../verification/UnverifiedBanner'
import { NotificationBell } from '../notifications/NotificationBell'
import styles from './AppShell.module.css'
import { useFocusRescue } from './focusRescue'
import { QuickSheet } from './QuickSheet'
import { useOnline } from './useOnline'
import { useToast } from './useToast'

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
const ICON = {
  home: MENU[0].icon,
  calendar: MENU[1].icon,
  tasks: MENU[2].icon,
  logs: MENU[3].icon,
  stats: MENU[4].icon,
  archive: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}
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

const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem} ${styles.active}` : styles.navItem

export function AppShell() {
  const { user } = useAuth()
  const online = useOnline()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dayClose, setDayClose] = useState<{ today: string; timeZone: string } | null>(null)
  const timer = usePaletteTimer()
  // 빠른 기록 시트(SCR-MOB-01). 닫아도 쓰던 글은 남긴다
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetText, setSheetText] = useState('')
  const [pendingFrom, setPendingFrom] = useState<{ today: string; timeZone: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // PWA 바로가기 '빠른 기록'(manifest shortcuts, /?quick=1)으로 열리면 시트를 바로 띄우고 주소에서 뺀다
  const quickParam = searchParams.get('quick') === '1'
  if (quickParam && !sheetOpen) setSheetOpen(true)
  useEffect(() => {
    if (!quickParam) return
    setSearchParams(
      (params) => {
        params.delete('quick')
        return params
      },
      { replace: true },
    )
  }, [quickParam, setSearchParams])

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
  // 연 순간의 오늘로 고정한다(자정을 넘겨도 마감하던 날이 바뀌지 않게)
  const openDayClose = useCallback(() => {
    const timeZone = user?.timezone ?? 'Asia/Seoul'
    setDayClose({ today: todayIn(timeZone), timeZone })
  }, [user?.timezone])
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

  // 모바일에서 하단 탭 위 타이머가 떠 있으면 토스트를 그 위로 올린다(TC-P2A-02). 타이머 높이는 안내 줄 수에 따라 달라 잰다.
  // 데스크톱·태블릿은 토스트가 사이드바 오른쪽에 떠서(Toast.module.css) 사이드바 타이머를 덮지 않는다
  const timerMobileRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dock = timerMobileRef.current
    if (!dock) return
    const root = document.documentElement
    const sync = () => {
      const h = dock.offsetHeight
      // 108px: 타이머의 bottom(AppShell.module.css), 8px: 틈
      if (h > 0) root.style.setProperty('--toast-bottom-mobile', `${108 + h + 8}px`)
      else root.style.removeProperty('--toast-bottom-mobile')
    }
    const observer = new ResizeObserver(sync)
    observer.observe(dock)
    sync()
    return () => {
      observer.disconnect()
      root.style.removeProperty('--toast-bottom-mobile')
    }
  }, [])

  // 누른 요소가 사라져 포커스가 body로 빠지면 이웃·화면 제목으로 되살린다(마지막 안전망, 화면별 처리가 우선)
  const contentRef = useRef<HTMLDivElement>(null)
  useFocusRescue(contentRef)

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="주 메뉴" data-app-sidebar>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            w
          </span>
          <span className={styles.brandName}>worklog</span>
          {/* SCR-COM-05 ② 종: 데스크톱·태블릿은 사이드바 위(모바일은 홈 머리 오른쪽) */}
          <NotificationBell className={styles.bell} />
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
        <div className={styles.timerSide}>
          <TimerMiniPlayer />
        </div>
        <NavLink to="/settings" className={navClass} title="설정">
          <Icon d={SETTINGS_ICON} />
          <span className={styles.navLabel}>설정</span>
        </NavLink>
      </nav>

      <div ref={contentRef} className={styles.content}>
        <UnverifiedBanner />
        {/* 끊긴 동안에는 화면마다 저장·편집 영역만 막는다(SCR-SYS-02 ③, 오프라인 기록은 범위 밖). 이동·열람은 된다 */}
        <div className={styles.main}>
          {/* 업무 완료 결과 입력(SCR-TASK-03)은 목록·홈·상세 어디서 완료해도 같은 팝오버를 띄운다 */}
          <CompletionResultHost>
            <Outlet />
          </CompletionResultHost>
        </div>
      </div>

      <div ref={timerMobileRef} className={styles.timerMobile}>
        <TimerMiniPlayer />
      </div>

      {/* 모바일 하단 탭(SCR-COM-01 ⑤). 아이콘 20px + 글자, 가운데 +는 빠른 기록 시트. 끊긴 동안에도 시트는 열리고 입력만 막힌다(SCR-MOB-01 ④) */}
      <nav className={styles.tabs} aria-label="하단 탭">
        <NavLink to="/" end className={tabClass}>
          <Icon d={ICON.home} size={20} />홈
        </NavLink>
        <NavLink to="/calendar" className={tabClass}>
          <Icon d={ICON.calendar} size={20} />
          캘린더
        </NavLink>
        <button
          type="button"
          className={styles.quick}
          aria-label="빠른 기록"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          <Icon d="M12 5v14M5 12h14" size={24} />
        </button>
        <NavLink to="/logs" className={tabClass}>
          <Icon d={ICON.logs} size={20} />
          일지
        </NavLink>
        <MoreMenu />
      </nav>

      {sheetOpen && (
        <QuickSheet
          text={sheetText}
          onTextChange={setSheetText}
          onClose={() => setSheetOpen(false)}
          onOpenPending={() => {
            const timeZone = user?.timezone ?? 'Asia/Seoul'
            setPendingFrom({ today: todayIn(timeZone), timeZone })
          }}
          onStartTimer={timer.commands?.start}
        />
      )}
      {pendingFrom && (
        <PendingPanel today={pendingFrom.today} timeZone={pendingFrom.timeZone} onClose={() => setPendingFrom(null)} />
      )}

      {paletteOpen && (
        <CommandPalette onClose={closePalette} onQuickAdd={quickAdd} onDayClose={openDayClose} timer={timer.commands} />
      )}
      {dayClose && (
        <DayClose
          date={dayClose.today}
          today={dayClose.today}
          timeZone={dayClose.timeZone}
          onClose={() => setDayClose(null)}
        />
      )}
      {timer.dialog}
    </div>
  )
}

// SCR-COM-03 ② 타이머 시작·정지 명령(P2-06). 시간 기록 옵션이 꺼져 있으면 commands=null(팔레트에서 숨김).
// 시작은 업무 고르기 창(실행 중이면 '다른 업무로 전환'), 정지는 결과를 토스트로 알린다.
// 끊긴 동안에는 미니 플레이어처럼 막고 이유를 토스트로 알린다(SCR-SYS-02 ③)
function usePaletteTimer() {
  const timed = useTimeTracking()
  const online = useOnline()
  const running = useRunningTimer(timed).data ?? null
  const { stop } = useTimerCommands()
  const { showToast } = useToast()
  const [starting, setStarting] = useState(false)

  const commands = timed
    ? {
        running: running !== null,
        offline: !online,
        start: () => {
          if (online) setStarting(true)
          else showToast(running ? '연결되면 타이머를 바꿀 수 있어요' : '연결되면 타이머를 시작할 수 있어요')
        },
        stop: async () => {
          if (!online) return showToast('연결되면 타이머를 멈출 수 있어요')
          try {
            showToast(stoppedMessage((await stop()).stopped))
          } catch (error) {
            const { message, traceId } = toastForError(error)
            showToast(message, { traceId })
          }
        },
      }
    : null
  const dialog = starting ? (
    <TimerStartDialog runningName={running?.content} onClose={() => setStarting(false)} />
  ) : null
  return { commands, dialog }
}

// SCR-COM-01 ⑤ 하단 탭 '더보기' (P1-X-01, P4-03 아이콘·통계·보관함).
// 열면 첫 항목으로, Esc·바깥 누르기·항목 선택으로 닫히면 더보기 버튼으로 포커스를 돌려준다.
const MORE = [
  { to: '/tasks', label: '업무', icon: ICON.tasks },
  { to: '/stats', label: '통계', icon: ICON.stats },
  { to: '/tasks/archive', label: '보관함', icon: ICON.archive },
  { to: '/settings', label: '설정', icon: SETTINGS_ICON },
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
        <Icon d={ICON.more} size={20} />
        더보기
      </button>
      {open && (
        <ul id={id} className={styles.moreMenu} aria-label="더보기 메뉴">
          {MORE.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className={styles.moreItem} onClick={() => close()}>
                <Icon d={m.icon} />
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

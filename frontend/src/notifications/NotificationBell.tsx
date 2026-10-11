// SCR-COM-05 ② 종(알림) 버튼과 안 읽은 수 배지(9 넘으면 9+). 데스크톱: 사이드바 위, 모바일: 홈 머리 오른쪽(배치는 AppShell·홈).
// 데스크톱·태블릿은 누르면 팝오버(모달 아님 — 바깥을 누르거나 Esc로 닫고 종으로 포커스를 돌린다), 모바일은 전체 화면 /notifications로 간다.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router'
import { useUnreadCount } from './api'
import { NOTIFICATIONS_PATH } from './format'
import { BellIcon, NotificationList } from './NotificationList'
import styles from './notifications.module.css'

const MOBILE_QUERY = '(max-width: 767px)'
const POPOVER_WIDTH = 400
const GAP = 8

function useMobile() {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(MOBILE_QUERY)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(MOBILE_QUERY).matches ?? false,
  )
}

export function NotificationBell({ className }: { className?: string }) {
  const mobile = useMobile()
  const count = useUnreadCount().data ?? 0
  const label = count > 0 ? `알림, 안 읽음 ${count}개` : '알림'
  const badge = count > 0 && (
    <span className={styles.badge} aria-hidden="true">
      {count > 9 ? '9+' : count}
    </span>
  )

  if (mobile) {
    return (
      <Link to={NOTIFICATIONS_PATH} className={`${styles.bell} ${className ?? ''}`} aria-label={label}>
        <BellIcon />
        {badge}
      </Link>
    )
  }
  return <DesktopBell className={className} label={label} badge={badge} />
}

function DesktopBell({ className, label, badge }: { className?: string; label: string; badge: React.ReactNode }) {
  // 연 화면의 경로를 기억해 둔다. 뒤로 가기 등으로 화면이 바뀌면 저절로 닫힌다
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const id = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpenAt(null)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  // 사이드바는 스크롤 영역이라 absolute면 잘린다. 화면 기준(fixed)으로 종 아래에 두고 오른쪽 끝을 넘지 않게
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - GAP * 2)
      const top = r.bottom + GAP
      setPos({
        top,
        left: Math.max(GAP, Math.min(r.left, window.innerWidth - width - GAP)),
        // 낮은 창에서도 아래가 잘리지 않게 남은 높이만큼(최대 640px, 넘치면 안에서 스크롤)
        maxHeight: Math.min(640, window.innerHeight - top - GAP),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // 위치를 잡기 전에는 visibility:hidden이라 focus()가 먹지 않는다. 자리를 잡은 뒤에 팝오버로 옮긴다
  const placed = open && pos !== null
  useEffect(() => {
    if (placed) popoverRef.current?.focus()
  }, [placed])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.bell} ${className ?? ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpenAt(pathname))}
        onKeyDown={(e) => {
          // 팝오버에서 Shift+Tab으로 종에 돌아온 뒤에도 Esc로 닫는다
          if (open && e.key === 'Escape') {
            e.stopPropagation()
            close(true)
          }
        }}
      >
        <BellIcon />
        {badge}
      </button>
      {open && (
        <section
          ref={popoverRef}
          id={id}
          role="dialog"
          aria-labelledby={`${id}-h`}
          tabIndex={-1}
          className={styles.popover}
          style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close(true)
            }
          }}
          onBlur={(e) => {
            // Tab으로 팝오버 밖에 나가면 닫는다(종으로 돌아갈 때는 그대로 — 종을 다시 누르면 닫힘)
            const next = e.relatedTarget as Node | null
            if (next && !e.currentTarget.contains(next) && next !== buttonRef.current) close(false)
          }}
        >
          <NotificationList
            onNavigate={() => close(false)}
            heading={(actions) => (
              <div className={styles.head}>
                <h2 id={`${id}-h`} className={styles.heading}>
                  알림
                </h2>
                {actions}
              </div>
            )}
          />
        </section>
      )}
    </>
  )
}

// SCR-COM-05 알림 센터 본문. 데스크톱 팝오버(NotificationBell)와 모바일 전체 화면(NotificationsPage)이 함께 쓴다.
// 항목을 누르면 읽음 처리하고 그 화면으로 간다. '모두 읽음'은 안 읽은 알림이 있을 때만 보인다.
// 비었을 때: 하루 마감 알림이 꺼져 있으면 설정 › 알림으로 보내는 버튼(그 자리에서 켜지 않음 — 푸시 권한까지 이어서 고르게)
import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { todayIn } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useWorklogMe } from '../settings/useWorklogSettings'
import { useMarkRead, useNotifications, type AppNotification } from './api'
import { NOTIFICATION_SETTINGS_PATH, notificationHref, notificationText, notificationTime } from './format'
import styles from './notifications.module.css'

interface Props {
  /** 제목 줄(제목·뒤로 버튼). 팝오버는 h2, 전체 화면은 h1 */
  heading: (actions: ReactNode) => ReactNode
  /** 항목·설정 링크로 이동할 때(팝오버를 닫는다) */
  onNavigate?: () => void
}

export function NotificationList({ heading, onNavigate }: Props) {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  const online = useOnline()
  const query = useNotifications()
  const { markRead, markAllRead } = useMarkRead()
  const listRef = useRef<HTMLUListElement>(null)
  // TODO(P4-01 생성 타입): WorklogSettings에 dailyCloseNotifyEnabled가 들어오면 캐스트를 뺀다
  const settings = useWorklogMe().data?.settings as { dailyCloseNotifyEnabled?: boolean } | undefined
  const notifyOff = settings?.dailyCloseNotifyEnabled === false

  const pages = query.data?.pages
  const items = pages?.flatMap((p) => p.items) ?? []
  const unread = pages?.[0]?.unreadCount ?? 0
  const hasUnread = unread > 0 || items.some((n) => !n.readAt)

  const actions = hasUnread && (
    <button
      type="button"
      className={styles.readAll}
      disabled={!online}
      onClick={(e) => {
        // 이 버튼은 사라지므로 포커스를 목록 첫 항목으로(없으면 팝오버·화면 영역이 받는다)
        const first = listRef.current?.querySelector<HTMLElement>('a')
        ;(first ?? e.currentTarget.closest<HTMLElement>('section'))?.focus()
        void markAllRead()
      }}
    >
      모두 읽음
    </button>
  )

  return (
    <>
      {heading(actions)}
      {query.isPending && (
        <div className={styles.state}>
          <Skeleton count={3} />
        </div>
      )}
      {query.isError && (
        <div role="alert" className={styles.state}>
          <p className={styles.stateTitle}>알림을 불러오지 못했어요</p>
          <button type="button" className={styles.retry} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </div>
      )}
      {query.isSuccess && items.length === 0 && (
        <div className={styles.empty}>
          <BellIcon size={40} className={styles.emptyIcon} />
          <p className={styles.stateTitle}>새 알림이 없어요</p>
          {notifyOff ? (
            <>
              <p className={styles.stateText}>
                하루 마감 알림이 꺼져 있어요. 켜면 마감 시각에 오늘 기록을 정리하라고 알려 드려요.
              </p>
              <Link to={NOTIFICATION_SETTINGS_PATH} className={styles.primary} onClick={onNavigate}>
                하루 마감 알림 켜기
              </Link>
            </>
          ) : (
            <p className={styles.stateText}>하루 마감과 일지 알림이 여기에 모여요</p>
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul ref={listRef} className={styles.list} aria-label="알림 목록">
          {items.map((n) => (
            <li key={n.id}>
              <Item
                n={n}
                today={today}
                timeZone={timeZone}
                onOpen={() => {
                  markRead(n)
                  onNavigate?.()
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className={styles.more}>
          <button
            type="button"
            className={styles.moreButton}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? '불러오는 중…' : '이전 알림 더 보기'}
          </button>
        </div>
      )}
      {query.isFetchNextPageError && (
        <p role="alert" className={styles.moreError}>
          이전 알림을 불러오지 못했어요
        </p>
      )}
      <div className={styles.footer}>
        <Link to={NOTIFICATION_SETTINGS_PATH} className={styles.settingsLink} onClick={onNavigate}>
          알림 설정
        </Link>
      </div>
    </>
  )
}

function Item({
  n,
  today,
  timeZone,
  onOpen,
}: {
  n: AppNotification
  today: string
  timeZone: string
  onOpen: () => void
}) {
  const { title, sub } = notificationText(n, today)
  const unread = !n.readAt
  const kind = n.type === 'DAILY_CLOSE' ? 'daily' : n.logType === 'MONTHLY' ? 'monthly' : 'weekly'
  return (
    <Link
      to={notificationHref(n)}
      className={unread ? `${styles.item} ${styles.unread}` : styles.item}
      onClick={onOpen}
    >
      <span className={`${styles.icon} ${styles[kind]}`} aria-hidden="true">
        {kind === 'daily' ? <MoonIcon /> : kind === 'monthly' ? '월' : '주'}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>
          {unread && <span className="visually-hidden">읽지 않음, </span>}
          {title}
        </span>{' '}
        {/* 블록 사이 빈칸: 화면에는 안 보이고 화면 낭독기가 붙여 읽지 않게 */}
        <span className={styles.sub}>{sub}</span>{' '}
        <span className={styles.time}>{notificationTime(n.createdAt, timeZone, today)}</span>
      </span>
      {unread && <span className={styles.dot} aria-hidden="true" />}
    </Link>
  )
}

const BELL_PATH = 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0'

export function BellIcon({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={BELL_PATH} />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

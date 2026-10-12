// SCR-COM-07 미인증 배너. 사용을 막지 않고(UX-04) 인증을 부드럽게 안내한다. 닫으면 이번 로그인 동안 숨긴다.
// 보이는 곳은 홈뿐(COM-20, WY-design 2026-10-12. 업무일지 화면은 숨김 2026-10-12로 빠짐): 막는 기능이 일지 내보내기 하나라 그 근처에서만 알린다
import { useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { focusPageHeading } from '../components/focusFallback'
import { hideBanner, isBannerHidden } from './bannerState'
import styles from './dialog.module.css'
import { EmailVerificationDialog } from './EmailVerificationDialog'

export function UnverifiedBanner() {
  const { user } = useAuth()
  const [hidden, setHidden] = useState(() => (user ? isBannerHidden(user.id) : false))
  const [dialogOpen, setDialogOpen] = useState(false)
  const openButton = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  const here = pathname === '/'

  // 인증을 마치면 즉시 사라진다. 인증 창이 열려 있으면 화면을 옮겨도 닫지 않는다
  if (!user || user.emailVerified || hidden) return null
  if (!here && !dialogOpen) return null

  return (
    <>
      {here && (
        <div role="region" aria-label="이메일 인증 안내" className={styles.banner}>
          <span className={styles.bannerIcon} aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
            </svg>
          </span>
          {/* 360~767px은 메일 주소를 빼고 짧게(한 줄), 그 밖은 주소를 굵게. 보이는 쪽만 읽힌다(display: none) */}
          <span className={`${styles.bannerText} ${styles.bannerTextLong}`}>
            <b>{user.email}</b> 인증을 마치면 일지를 내보낼 수 있어요
          </span>
          <span className={`${styles.bannerText} ${styles.bannerTextShort}`}>인증하면 일지를 내보낼 수 있어요</span>
          <button ref={openButton} type="button" className={styles.bannerAction} onClick={() => setDialogOpen(true)}>
            인증하기
          </button>
          <button
            type="button"
            className={styles.bannerClose}
            aria-label="이번 로그인 동안 숨기기"
            onClick={() => {
              // 배너가 사라지므로 포커스를 화면 제목으로 옮긴다
              focusPageHeading()
              hideBanner(user.id)
              setHidden(true)
            }}
          >
            ×
          </button>
        </div>
      )}
      {dialogOpen && (
        <EmailVerificationDialog
          onClose={() => {
            setDialogOpen(false)
            openButton.current?.focus()
          }}
        />
      )}
    </>
  )
}

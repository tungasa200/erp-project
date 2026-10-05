// SCR-COM-07 미인증 배너. 사용을 막지 않고(UX-04) 인증을 부드럽게 안내한다. 닫으면 이번 로그인 동안 숨긴다.
import { useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { hideBanner, isBannerHidden } from './bannerState'
import styles from './dialog.module.css'
import { EmailVerificationDialog } from './EmailVerificationDialog'

export function UnverifiedBanner() {
  const { user } = useAuth()
  const [hidden, setHidden] = useState(() => (user ? isBannerHidden(user.id) : false))
  const [dialogOpen, setDialogOpen] = useState(false)
  const openButton = useRef<HTMLButtonElement>(null)

  // 인증을 마치면 즉시 사라진다
  if (!user || user.emailVerified || hidden) return null

  return (
    <>
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
        <span className={styles.bannerText}>
          <b>{user.email}</b> 인증을 마치면 일지를 내보낼 수 있어요
        </span>
        <button ref={openButton} type="button" className={styles.bannerAction} onClick={() => setDialogOpen(true)}>
          인증하기
        </button>
        <button
          type="button"
          className={styles.bannerClose}
          aria-label="이번 로그인 동안 숨기기"
          onClick={() => {
            hideBanner(user.id)
            setHidden(true)
          }}
        >
          ×
        </button>
      </div>
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

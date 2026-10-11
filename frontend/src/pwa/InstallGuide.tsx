// SCR-MOB-02 PWA 설치 안내 카드(보드 MOB-02a). 모바일 홈 화면 하단 탭 위에 뜬다(≤767px, 넓은 화면은 CSS로 숨김).
// Android·삼성 인터넷: 브라우저가 설치 창을 줄 수 있을 때만 [설치] 카드. iPhone·iPad Safari: 공유 → 홈 화면에 추가 안내.
// 데스크톱 Chrome·Edge는 카드 대신 설정 › 일반의 설치 버튼(GeneralSettings InstallAppRow).
import { useState } from 'react'
import { useToast } from '../components/useToast'
import {
  countVisit,
  hideFor30Days,
  isIos,
  isStandalone,
  mayShowInstallGuide,
  promptInstall,
  useCanInstall,
} from './install'
import styles from './install.module.css'

export const INSTALLED_TOAST = '홈 화면에 WY Worklog를 추가했어요'

/** 카드가 사라지면 포커스를 하단 탭의 지금 탭(홈)으로 돌린다 */
function returnFocus() {
  document.querySelector<HTMLElement>('nav[aria-label="하단 탭"] a[aria-current="page"]')?.focus()
}

export function InstallGuide() {
  // 두 번째 방문부터(첫 방문은 앱을 둘러볼 시간). 화면을 여는 동안 한 번만 센다
  const [eligible] = useState(() => !isStandalone() && countVisit() >= 2 && mayShowInstallGuide())
  const [closed, setClosed] = useState(false)
  const canInstall = useCanInstall()
  const { showToast } = useToast()

  if (!eligible || closed) return null
  const kind = canInstall ? 'install' : isIos() ? 'ios' : null
  if (!kind) return null

  const hide = () => {
    hideFor30Days()
    setClosed(true)
    returnFocus()
  }

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') showToast(INSTALLED_TOAST)
    else if (outcome === 'dismissed') hideFor30Days()
    setClosed(true)
    returnFocus()
  }

  const close = (
    <button type="button" className={styles.close} aria-label="30일 동안 숨기기" onClick={hide}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )

  if (kind === 'install') {
    return (
      <section className={styles.card} aria-labelledby="install-guide-title">
        <div className={styles.row}>
          <span className={styles.icon} aria-hidden="true">
            WL
          </span>
          <div className={styles.text}>
            <h2 id="install-guide-title" className={styles.title}>
              WY Worklog 앱 설치
            </h2>
            <p className={styles.description}>홈 화면에서 바로 열고 알림도 받아요</p>
          </div>
          <button type="button" className={styles.install} onClick={() => void install()}>
            설치
          </button>
          {close}
        </div>
      </section>
    )
  }

  return (
    <section className={`${styles.card} ${styles.ios}`} aria-labelledby="install-guide-title">
      <div className={styles.row}>
        <span className={styles.icon} aria-hidden="true">
          WL
        </span>
        <div className={styles.text}>
          <h2 id="install-guide-title" className={`${styles.title} ${styles.titleIos}`}>
            홈 화면에 WY Worklog 추가
          </h2>
          <p className={styles.description}>앱처럼 바로 열고 기록하세요</p>
        </div>
        {close}
      </div>
      {/* list-style을 없애면 Safari가 목록으로 읽지 않아 role을 다시 준다 */}
      <ol className={styles.steps} role="list">
        <li className={styles.step}>
          <span>
            아래 <strong>공유</strong> 버튼을 누르세요
          </span>
          <svg
            className={styles.share}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" />
          </svg>
        </li>
        <li className={styles.step}>
          <span>
            <strong>홈 화면에 추가</strong>를 고르세요
          </span>
        </li>
      </ol>
    </section>
  )
}

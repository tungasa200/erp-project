// 앱 최상단 틀: 오프라인 띠가 뜨면 그 아래 영역을 띠 높이만큼 줄인다(띠가 화면을 가리지 않게).
import type { ReactNode } from 'react'
import styles from './AppFrame.module.css'
import { OfflineBanner } from './OfflineBanner'

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <OfflineBanner />
      <div className={styles.body}>{children}</div>
    </div>
  )
}

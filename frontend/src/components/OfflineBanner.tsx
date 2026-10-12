// SCR-SYS-02 ③ 오프라인 상단 띠. 로그인 전 화면을 포함해 앱 전체에 띄운다(라우터 바깥).
// 띠는 내용과 함께 새로 생겨서 role="status"만으로는 일부 낭독기가 알리지 않는다. 늘 붙어 있는 낭독 영역으로 알린다(UX-COM-13)
import { useEffect, useRef } from 'react'
import { announce } from './announce'
import styles from './OfflineBanner.module.css'
import { useOnline } from './useOnline'

export function OfflineBanner() {
  const online = useOnline()
  const wasOffline = useRef(false)
  useEffect(() => {
    if (!online) announce('연결이 끊겼어요. 다시 연결되면 입력할 수 있어요')
    else if (wasOffline.current) announce('다시 연결됐어요')
    wasOffline.current = !online
  }, [online])
  if (online) return null
  return (
    <div className={styles.offline}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.message}>
        연결이 끊겼어요<span className={styles.detail}>. 다시 연결되면 입력할 수 있어요</span>
      </span>
      <span className={styles.retrying}>재시도 중…</span>
    </div>
  )
}

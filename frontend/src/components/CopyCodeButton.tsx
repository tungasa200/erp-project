// 문의 코드(traceId) 표시와 복사 (D-35)
import { useState } from 'react'
import styles from './CopyCodeButton.module.css'

export function CopyCodeButton({ code, inverted = false }: { code: string; inverted?: boolean }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 권한이 없으면 코드를 직접 보고 옮겨 적을 수 있다.
    }
  }

  return (
    <span className={inverted ? `${styles.wrap} ${styles.inverted}` : styles.wrap}>
      문의 코드 <b className={styles.code}>{code}</b>
      <button type="button" className={styles.button} onClick={copy}>
        {copied ? '복사됨' : '복사'}
      </button>
    </span>
  )
}

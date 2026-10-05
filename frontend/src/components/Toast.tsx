// 오류 알림 토스트 (화면정의서 2.5: 저장·통신 오류는 토스트, 5xx는 문의 코드와 복사 버튼).
// 되돌리기 토스트(SCR-COM-04)는 P1에서 이 위에 만든다.
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { CopyCodeButton } from './CopyCodeButton'
import styles from './Toast.module.css'
import { ToastContext, type ToastValue } from './useToast'

interface ToastItem {
  id: number
  message: string
  traceId?: string
}

const DURATION_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const showToast = useCallback<ToastValue['showToast']>(
    (message, options) => {
      const id = nextId.current++
      setItems((list) => [...list, { id, message, traceId: options?.traceId }])
      // 문의 코드가 있으면 복사할 시간을 주기 위해 자동으로 닫지 않는다.
      if (!options?.traceId) setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={styles.toast}>
            <span className={styles.message}>{t.message}</span>
            {t.traceId && <CopyCodeButton code={t.traceId} inverted />}
            <button type="button" className={styles.close} aria-label="닫기" onClick={() => dismiss(t.id)}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

// 캘린더의 모달 틀: 바깥 누르기·Esc로 닫고, 열 때 첫 입력에 포커스, 닫으면 원래 자리로 포커스를 돌린다.
import { useEffect, useRef, type ReactNode } from 'react'
import { markFocus, restoreFocus } from './focus'
import styles from './calendar.module.css'

interface Props {
  labelledBy: string
  onClose: () => void
  narrow?: boolean
  role?: 'dialog' | 'alertdialog'
  children: ReactNode
}

export function Modal({ labelledBy, onClose, narrow, role = 'dialog', children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = markFocus()
    // 머리의 닫기(×)가 DOM 첫 버튼이라 입력 칸을 먼저 찾고, 칸이 없으면(확인만 하는 창) 제출 버튼, 그다음 아무 버튼
    const dialog = ref.current
    const first = [
      'input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      'button[type=submit]:not(:disabled)',
      'button:not(:disabled)',
    ]
      .map((selector) => dialog?.querySelector<HTMLElement>(selector))
      .find(Boolean)
    first?.focus()
    return () => restoreFocus(previous)
  }, [])

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`${styles.dialog} ${narrow ? styles.dialogNarrow : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

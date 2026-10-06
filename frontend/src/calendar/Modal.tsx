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
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select, button')
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

// 캘린더의 모달 틀: 바깥 누르기·Esc로 닫고, 열 때 첫 입력에 포커스, 닫으면 원래 자리로 포커스를 돌린다.
// 열린 동안 Tab은 창 안을 돌고, 창 밖(사이드바·본문)은 inert로 막는다(TC-P3-prod-ONB01-focus).
import { useEffect, useRef, type ReactNode } from 'react'
import { markFocus, restoreFocus } from './focus'
import styles from './calendar.module.css'

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** 창의 조상 사슬만 남기고 그 형제를 inert로. 알림 영역(aria-live)은 창이 열려도 읽혀야 해서 남긴다. 되돌릴 목록을 돌려준다 */
function inertOutside(dialog: HTMLElement) {
  const changed: HTMLElement[] = []
  for (let node: HTMLElement | null = dialog; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute('inert')) continue
      if (sibling.matches('[aria-live], script, style')) continue
      sibling.setAttribute('inert', '')
      changed.push(sibling)
    }
  }
  return () => changed.forEach((el) => el.removeAttribute('inert'))
}

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
    const release = dialog ? inertOutside(dialog) : () => {}
    return () => {
      // inert를 먼저 풀어야 원래 자리로 포커스가 돌아간다
      release()
      restoreFocus(previous)
    }
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
          } else if (e.key === 'Tab' && !e.defaultPrevented && ref.current) {
            const items = Array.from(ref.current.querySelectorAll<HTMLElement>(TABBABLE)).filter(
              (el) => !el.closest('[hidden], [inert]'),
            )
            const first = items[0]
            const last = items[items.length - 1]
            const active = document.activeElement
            if (!first) {
              e.preventDefault()
            } else if (e.shiftKey && (active === first || !ref.current.contains(active))) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

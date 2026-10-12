// 캘린더의 모달 틀: 바깥 누르기·Esc로 닫고, 열 때 첫 입력에 포커스, 닫으면 원래 자리로 포커스를 돌린다.
// 열린 동안 Tab은 창 안을 돌고, 창 밖(사이드바·본문)은 inert로 막는다(TC-P3-prod-ONB01-focus).
// 고친 내용이 있으면(dirty) Esc·바깥 누르기는 바로 닫지 않고 창 안 한 줄로 한 번 묻는다(X-04 대화창 안 D, CAL-89).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { markFocus, restoreFocus } from './focus'
import styles from './calendar.module.css'

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Tab이 멈추는 자리 차례. 라디오 묶음은 브라우저처럼 한 자리: 같은 name 중 선택된 것(없으면 첫 것)만 */
function tabOrder(dialog: HTMLElement): HTMLElement[] {
  // 문서 차례로 정렬한다(jsdom은 쉼표 선택자 결과를 선택자별로 묶어 돌려준다)
  const all = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE))
    .filter((el) => !el.closest('[hidden], [inert]'))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true
    const group = all.filter(
      (other): other is HTMLInputElement =>
        other instanceof HTMLInputElement && other.type === 'radio' && other.name === el.name,
    )
    return el === (group.find((r) => r.checked) ?? group[0])
  })
}

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
  /** 모바일(~767px)에서 아래에서 올라오는 시트로 띄운다(통계 기간 고르기) */
  sheet?: boolean
  role?: 'dialog' | 'alertdialog'
  /** 처음 값과 달라진 내용이 있다. 닫기 전에 [계속 편집]·[버리고 닫기]를 묻는다 */
  dirty?: boolean
  children: ReactNode
}

export function Modal({ labelledBy, onClose, narrow, sheet, role = 'dialog', dirty, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const askId = useId()
  // 물을 때 포커스가 있던 칸. [계속 편집]이면 그 자리로 돌아간다
  const [asking, setAsking] = useState<HTMLElement | null>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  // 바깥 누르기는 누름과 뗌이 모두 바깥일 때만(창 안에서 끌어 바깥에서 떼면 닫지 않는다)
  const downOutside = useRef(false)

  const requestClose = () => {
    if (!dirty) return onClose()
    const active = document.activeElement
    setAsking(active instanceof HTMLElement && ref.current?.contains(active) ? active : (ref.current ?? null))
  }
  const keepEditing = () => {
    const back = asking
    setAsking(null)
    back?.focus()
  }
  useEffect(() => {
    if (asking) keepRef.current?.focus()
  }, [asking])

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
    <div
      className={styles.overlay}
      onPointerDown={(e) => {
        downOutside.current = e.target === e.currentTarget
      }}
      onPointerUp={(e) => {
        const outside = downOutside.current && e.target === e.currentTarget
        downOutside.current = false
        if (outside && !asking) requestClose()
      }}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`${styles.dialog} ${narrow ? styles.dialogNarrow : ''} ${sheet ? styles.dialogSheet : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            // 물은 뒤 Esc 한 번 더 = 계속 편집
            if (asking) keepEditing()
            else requestClose()
          } else if (e.key === 'Tab' && !e.defaultPrevented && ref.current) {
            const items = tabOrder(ref.current)
            const first = items[0]
            const last = items[items.length - 1]
            const active = document.activeElement as HTMLElement | null
            // 처음 포커스가 목록 첫 자리가 아닐 수 있다(내보내기의 선택된 라디오, 완료 화면 제목). 그 자리가 첫 자리 이하면 앞으로 나가지 않게
            const at = active ? items.indexOf(active) : -1
            if (!first) {
              e.preventDefault()
            } else if (e.shiftKey && (at <= 0 || !ref.current.contains(active))) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        {asking && (
          <div role="group" aria-labelledby={askId} className={styles.discardBar}>
            <span id={askId} className={styles.discardText}>
              고친 내용이 있어요. 버리고 닫을까요?
            </span>
            <button type="button" ref={keepRef} className={styles.secondary} onClick={keepEditing}>
              계속 편집
            </button>
            <button type="button" className={styles.danger} onClick={onClose}>
              버리고 닫기
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

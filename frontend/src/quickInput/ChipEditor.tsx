// SCR-COM-02 칩 수정 드롭다운 (P1-09-12). 칩을 누르면 그 값만 고친다.
// 입력창 글자가 원본이라 고른 값은 그 칩의 낱말 자리에 글자로 바꿔 쓴다(onPick). 빈 글자는 그 낱말을 뺀다.
// 포커스: 열면 지금 값(없으면 첫 항목)으로, Esc·Tab은 칩으로 돌아가고, 고르면 입력창으로 간다(QuickInput이 맡음).
import { useId, useLayoutEffect, useRef, useState } from 'react'
import styles from './QuickInput.module.css'

export interface ChipOption {
  label: string
  /** 옆에 흐리게 붙는 설명(실제 날짜 등) */
  detail?: string
  /** 낱말 자리에 넣을 글자 */
  value: string
  current?: boolean
}

export type ChipEdit =
  | { kind: 'options'; title: string; options: ChipOption[]; removeLabel: string }
  | { kind: 'time'; title: string; start: string; end: string; removeLabel: string }

interface Props {
  edit: ChipEdit
  onPick: (replacement: string) => void
  /** Esc·Tab: 칩으로 포커스를 돌린다. outside: 바깥을 눌렀거나 포커스가 나가서 그대로 둔다 */
  onClose: (by: 'keyboard' | 'outside') => void
}

export function ChipEditor({ edit, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [alignRight, setAlignRight] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // 화면 오른쪽 끝 칩이면 칩 오른쪽에 맞춰 연다(좁은 화면에서 잘리지 않게)
    if (el.getBoundingClientRect().right > window.innerWidth - 16) setAlignRight(true)
    const first =
      el.querySelector<HTMLElement>('[aria-checked="true"]') ??
      el.querySelector<HTMLElement>('input, [role^="menuitem"]')
    first?.focus()
  }, [])

  // 바깥을 누르면 닫는다. 칩(부모 li) 안을 누른 것은 칩 버튼이 열고 닫기를 맡는다
  useLayoutEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose('outside')
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  const common = {
    ref,
    className: `${styles.chipMenu} ${alignRight ? styles.chipMenuRight : ''}`,
    'aria-label': edit.title,
    onBlur: (e: React.FocusEvent) => {
      // 마우스로 다른 곳을 눌러 포커스가 나가면 닫는다(칩 버튼으로 간 것은 칩 버튼이 처리)
      if (e.relatedTarget && !ref.current?.parentElement?.contains(e.relatedTarget as Node)) onClose('outside')
    },
  }

  if (edit.kind === 'time') return <TimeForm {...common} edit={edit} onPick={onPick} onClose={onClose} />

  const moveFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <div
      {...common}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          e.stopPropagation()
          onClose('keyboard')
        } else moveFocus(e)
      }}
    >
      {edit.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={o.current ?? false}
          tabIndex={-1}
          className={styles.chipOption}
          onClick={() => onPick(o.value)}
        >
          <span>{o.label}</span>
          {o.detail && <span className={styles.chipOptionDetail}>{o.detail}</span>}
          {o.current && (
            <span className={styles.chipOptionCheck} aria-hidden="true">
              ✓
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={`${styles.chipOption} ${styles.chipRemove}`}
        onClick={() => onPick('')}
      >
        {edit.removeLabel}
      </button>
    </div>
  )
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function TimeForm({
  edit,
  onPick,
  onClose,
  ...common
}: Props & { edit: Extract<ChipEdit, { kind: 'time' }> } & React.HTMLAttributes<HTMLDivElement> & {
    ref: React.Ref<HTMLDivElement>
  }) {
  const [start, setStart] = useState(edit.start)
  const [end, setEnd] = useState(edit.end)
  const errorId = useId()
  const valid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && toMinutes(end) > toMinutes(start)
  const apply = () => valid && onPick(`${start}-${end}`)

  return (
    <div
      {...common}
      role="dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose('keyboard')
        }
      }}
    >
      <div className={styles.timeFields}>
        <label className={styles.timeField}>
          <span>시작</span>
          <input
            type="time"
            step={300}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())}
          />
        </label>
        <label className={styles.timeField}>
          <span>끝</span>
          <input
            type="time"
            step={300}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())}
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : errorId}
          />
        </label>
      </div>
      {!valid && (
        <p id={errorId} className={styles.timeError} role="alert">
          끝 시각은 시작보다 늦어야 해요
        </p>
      )}
      <div className={styles.timeActions}>
        <button type="button" className={`${styles.chipOption} ${styles.chipRemove}`} onClick={() => onPick('')}>
          {edit.removeLabel}
        </button>
        <button type="button" className={styles.timeApply} disabled={!valid} onClick={apply}>
          바꾸기
        </button>
      </div>
    </div>
  )
}

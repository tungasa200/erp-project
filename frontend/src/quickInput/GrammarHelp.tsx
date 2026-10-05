// SCR-ONB-02 빠른 입력 문법 도움말. 예시를 누르면 입력창에 채운다.
import { useEffect, useRef } from 'react'
import { EXAMPLES } from './examples'
import styles from './QuickInput.module.css'

const RULES = [
  { k: '14-16 · 9:30-10', v: '시간 — 일정이 함께 만들어져요' },
  { k: '#영업', v: '프로젝트 (없으면 새로 만들지 물어봐요)' },
  { k: '!높음 · !낮음', v: '우선순위 (기본 보통)' },
  { k: '~금 · ~10/12', v: '마감일' },
  { k: '오늘 · 내일 · 다음주 수요일', v: '날짜' },
]

export function GrammarHelp({ onClose, onPick }: { onClose: () => void; onPick: (example: string) => void }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  return (
    <section
      ref={ref}
      role="dialog"
      aria-labelledby="grammar-help-title"
      tabIndex={-1}
      className={styles.popover}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <h2 id="grammar-help-title" className={styles.popoverTitle}>
        한 줄 입력 문법
      </h2>
      <dl className={styles.rules}>
        {RULES.map((r) => (
          <div key={r.k} className={styles.rule}>
            <dt>
              <code className={styles.code}>{r.k}</code>
            </dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.examplesLabel}>예시 — 눌러서 입력해 보기</p>
      <div className={styles.examples}>
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className={styles.example} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </section>
  )
}

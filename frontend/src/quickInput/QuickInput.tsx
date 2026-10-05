// SCR-COM-02 빠른 입력창. 입력하는 동안 해석 결과를 칩으로 미리 보여 준다(오해석 방지).
// 저장(onSubmit)은 업무·일정 API가 생기면(P1-03·05) 연결한다. 칩 수정 드롭다운, 새 프로젝트 확인,
// 자주 하는 업무 제안(④)도 프로젝트·업무 데이터가 필요해 그때 붙인다.
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { shortDate, todayIn, weekStartNumber } from './dates'
import { GrammarHelp } from './GrammarHelp'
import { parseQuickInput, toDraft, type Priority, type QuickDraft } from './parse'
import styles from './QuickInput.module.css'

const PRIORITY_LABEL: Record<Priority, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' }

interface Chip {
  kind: 'time' | 'project' | 'priority' | 'due'
  text: string
  strong?: boolean
}

function chipsOf(draft: QuickDraft, today: string): Chip[] {
  const day = (date: string) => (date === today ? '오늘' : shortDate(date))
  const chips: Chip[] = []
  if (draft.schedule) {
    const { date, start, end } = draft.schedule
    chips.push({ kind: 'time', text: `${day(date)} ${start}–${end}` })
  }
  if (draft.project) chips.push({ kind: 'project', text: `#${draft.project}` })
  if (draft.priority) {
    chips.push({
      kind: 'priority',
      text: `우선순위 ${PRIORITY_LABEL[draft.priority]}`,
      strong: draft.priority === 'HIGH',
    })
  }
  if (draft.due) chips.push({ kind: 'due', text: `마감 ${day(draft.due)}` })
  return chips
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit?: (draft: QuickDraft) => void | Promise<void>
  label?: string
}

export function QuickInput({ value, onChange, onSubmit, label = '빠른 입력' }: Props) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // Esc로 닫으면 포커스를 ? 버튼으로 돌려준다. 바깥을 눌러 닫을 때는 누른 곳에 포커스를 둔다.
  const closeHelp = useCallback((by: 'escape' | 'outside') => {
    setHelpOpen(false)
    if (by === 'escape') helpButtonRef.current?.focus()
  }, [])
  const id = useId()

  const today = todayIn(user?.timezone ?? 'Asia/Seoul')
  const weekStart = weekStartNumber(user?.weekStart)
  const draft = useMemo(() => toDraft(parseQuickInput(value, { today, weekStart }), today), [value, today, weekStart])
  const chips = chipsOf(draft, today)
  const typing = value.trim() !== ''

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter는 조합 확정이라 저장하지 않는다.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      onChange('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!onSubmit || draft.title === '') return
      void Promise.resolve(onSubmit(draft)).then(() => onChange(''))
    }
  }

  return (
    <div className={styles.wrap}>
      <label htmlFor={id} className={styles.srOnly}>
        {label}
      </label>
      <div className={styles.field}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          className={styles.input}
          placeholder="무엇을 하셨나요? 한 줄로 적어 보세요"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby={typing ? `${id}-preview` : undefined}
          data-quick-input
        />
        {typing && onSubmit ? (
          <span className={styles.enter}>Enter 저장</span>
        ) : (
          <kbd className={styles.kbd} aria-hidden="true">
            N
          </kbd>
        )}
        <button
          type="button"
          ref={helpButtonRef}
          className={styles.help}
          aria-label="문법 도움말"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          ?
        </button>
      </div>

      {typing && (
        <div id={`${id}-preview`} className={styles.preview}>
          {chips.length > 0 && (
            <ul className={styles.chips} aria-label="해석 결과">
              {chips.map((c) => (
                <li
                  key={c.kind}
                  className={[styles.chip, styles[c.kind], c.strong && styles.strong].filter(Boolean).join(' ')}
                >
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>
            {draft.title === ''
              ? '할 일 이름을 적어 주세요'
              : draft.schedule
                ? '일정과 업무가 함께 만들어져요'
                : '업무가 만들어져요'}
          </p>
        </div>
      )}

      {helpOpen && (
        <GrammarHelp
          onClose={closeHelp}
          onPick={(example) => {
            onChange(example)
            setHelpOpen(false)
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

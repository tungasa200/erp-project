// SCR-HOME-03 빈 시간 메우기 (P2-07, TIME-11). ① 구간 시간 ② 후보 3종(직전 업무 이어서·이 시간 계획·자주 하는 업무) ③ 직접 입력.
// 후보를 한 번 누르면 그 구간 기록이 생긴다. 되돌리기 토스트: 새 기록은 보관, 확정한 확인 대기는 다시 확인 대기로.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import calendarStyles from '../calendar/calendar.module.css'
import { Modal } from '../calendar/Modal'
import { formatMinutes, toZoned } from '../calendar/time'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { recordApi } from '../records/api'
import { pendingApi } from '../records/pending'
import { durationText, fillGap, type GapChoice, type TimeGap } from './gaps'
import styles from './GapFill.module.css'

interface Props {
  gap: TimeGap
  timeZone: string
  /** filled: 채워서 닫힘 */
  onClose: (filled: boolean) => void
}

export function GapFill({ gap, timeZone, onClose }: Props) {
  const titleId = useId()
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [content, setContent] = useState('')
  const span = spanText(gap, timeZone)
  // 열면 첫 후보로(없거나 끊겨서 막혔으면 직접 입력). Modal은 DOM 첫 버튼(닫기)에 두므로 그 뒤에 옮긴다
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    ;(first ?? inputRef.current)?.focus()
  }, [])

  const fill = async (choice: GapChoice) => {
    if (busy) return
    setBusy(true)
    try {
      const saved = await fillGap(gap, choice)
      const wasPending = choice.kind === 'plan' && choice.plan.pendingRecordId !== null
      showUndo({
        group: 'gap-fill',
        message: (n) => (n > 1 ? `빈 시간 ${n}곳을 채웠어요` : `${span}을 채웠어요`),
        undo: async () => {
          try {
            if (wasPending) await pendingApi.setStatus(saved.id, 'PENDING', saved.version)
            else await recordApi.remove(saved.id)
          } catch (error) {
            const { message, traceId } = toastForError(error)
            showToast(message, { traceId })
          }
          void queryClient.invalidateQueries({ queryKey: ['records'] })
        },
      })
      void queryClient.invalidateQueries({ queryKey: ['records'] })
      onClose(true)
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: ['records', 'gaps'] })
      const { message, traceId } = toastForError(error)
      showToast(message, { traceId })
      setBusy(false)
    }
  }

  const candidates: { key: string; label: string; text: string; choice: GapChoice }[] = []
  if (gap.previous)
    candidates.push({
      key: 'previous',
      label: '직전 업무 이어서',
      text: gap.previous.content,
      choice: { kind: 'previous', content: gap.previous.content, taskId: gap.previous.taskId },
    })
  if (gap.plan)
    candidates.push({
      key: 'plan',
      label: '이 시간 계획',
      text: gap.plan.title,
      choice: { kind: 'plan', plan: gap.plan },
    })
  if (gap.frequent)
    candidates.push({
      key: 'frequent',
      label: '자주 하는 업무',
      text: gap.frequent.title,
      choice: { kind: 'frequent', content: gap.frequent.title, taskId: gap.frequent.latestTaskId },
    })

  const disabled = busy || !online
  const trimmed = content.trim()

  return (
    <Modal labelledBy={titleId} onClose={() => onClose(false)} narrow>
      <div className={calendarStyles.dialogHead}>
        <h2 id={titleId}>빈 시간 메우기</h2>
        <button type="button" className={calendarStyles.close} aria-label="닫기" onClick={() => onClose(false)}>
          ×
        </button>
      </div>
      <p className={styles.span}>
        {span} <span className={styles.minutes}>{durationText(gap.minutes)}</span>
      </p>

      {candidates.length > 0 && (
        <ul ref={listRef} className={styles.candidates} aria-label="후보">
          {candidates.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                className={styles.candidate}
                disabled={disabled}
                onClick={() => void fill(c.choice)}
              >
                <span className={styles.candidateLabel}>{c.label}</span>
                <span className={styles.candidateText} title={c.text}>
                  {c.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.direct}
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) void fill({ kind: 'direct', content: trimmed, taskId: null })
        }}
      >
        <label className={calendarStyles.field}>
          직접 입력
          <input
            ref={inputRef}
            className={calendarStyles.input}
            value={content}
            maxLength={500}
            placeholder="이 시간에 한 일"
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <button type="submit" className={calendarStyles.primary} disabled={disabled || !trimmed}>
          저장
        </button>
      </form>
      {!online && <p className={styles.muted}>연결되면 채울 수 있어요</p>}
    </Modal>
  )
}

function spanText(gap: TimeGap, timeZone: string) {
  return `${formatMinutes(toZoned(gap.startAt, timeZone).minutes)} – ${formatMinutes(toZoned(gap.endAt, timeZone).minutes)}`
}

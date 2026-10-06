// 일정 빠른 생성 (SCR-CAL-06). 선택한 시간이 기본이고, 입력에 시간·날짜가 있으면 그 값으로 덮어쓴다.
// 한 줄 해석은 빠른 입력(P1-09)의 parseQuickInput을 쓴다. "업무로도 만들기"(④)는 업무 API(P1-03)가 나오면 붙인다.
import { useEffect, useId, useMemo, useState } from 'react'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { toastForError } from '../api/errorToast'
import { weekStartNumber } from '../quickInput/dates'
import { parseQuickInput } from '../quickInput/parse'
import { useCreateSchedule } from './api'
import { markFocus, restoreFocus } from './focus'
import { MINUTES_PER_DAY, WEEKDAY_LABELS, formatMinutes, fromZoned, todayIn, weekdayIndex } from './time'
import styles from './calendar.module.css'

/** 빠른 생성의 대상. allDay면 start·end는 쓰지 않는다 */
export interface CreateTarget {
  date: string
  start: number
  end: number
  allDay: boolean
}

export interface ScheduleDraft extends CreateTarget {
  title: string
  /** 업무 패널의 "일정 잡기"로 열면 그 업무에 연결한다(P1-08) */
  taskId?: string
}

interface Props {
  target: CreateTarget
  timeZone: string
  /** 팝오버를 띄울 화면 좌표 */
  anchor: { x: number; y: number }
  onClose: () => void
  onDetails: (draft: ScheduleDraft) => void
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.min(MINUTES_PER_DAY, h * 60 + m)
}

function targetLabel(t: CreateTarget) {
  const [, m, d] = t.date.split('-').map(Number)
  const day = `${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayIndex(t.date)]})`
  return t.allDay ? `${day} 종일` : `${day} ${formatMinutes(t.start)}–${formatMinutes(t.end)}`
}

export function QuickCreate({ target, timeZone, anchor, onClose, onDetails }: Props) {
  const id = useId()
  const { user } = useAuth()
  const { showToast } = useToast()
  const create = useCreateSchedule()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 닫으면 연 자리로 포커스를 돌린다(빈 칸을 눌러 열었으면 캘린더 제목)
  useEffect(() => {
    const previous = markFocus()
    return () => restoreFocus(previous)
  }, [])

  const today = todayIn(timeZone)
  const parsed = useMemo(
    () => parseQuickInput(text, { today, weekStart: weekStartNumber(user?.weekStart) }),
    [text, today, user?.weekStart],
  )
  // 입력에 시간이 있으면 시간 일정, 날짜가 있으면 그 날짜로 바꾼다
  const draft: ScheduleDraft = {
    title: parsed.title,
    date: parsed.date ?? target.date,
    allDay: parsed.time ? false : target.allDay,
    start: parsed.time ? toMinutes(parsed.time.start) : target.start,
    end: parsed.time ? toMinutes(parsed.time.end) : target.end,
  }
  const overridden = draft.date !== target.date || draft.start !== target.start || draft.allDay !== target.allDay

  const save = async () => {
    if (!draft.title) {
      setError('일정 이름을 적어 주세요')
      return
    }
    try {
      await create.mutateAsync(
        draft.allDay
          ? { title: draft.title, allDay: true, startDate: draft.date, endDate: draft.date }
          : {
              title: draft.title,
              allDay: false,
              startAt: fromZoned(draft.date, draft.start, timeZone),
              endAt: fromZoned(draft.date, draft.end, timeZone),
            },
      )
      showToast('일정을 만들었어요')
      onClose()
    } catch (err) {
      const fieldError = err instanceof ApiError ? err.problem?.errors?.[0] : undefined
      if (fieldError?.field === 'title') setError('일정 이름을 확인해 주세요')
      else if (fieldError) setError('시간을 확인해 주세요')
      else {
        const { message, traceId } = toastForError(err)
        showToast(message, { traceId })
      }
    }
  }

  return (
    <div className={styles.popoverLayer} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={styles.popover}
        style={{
          left: Math.max(16, Math.min(anchor.x, window.innerWidth - 396)),
          top: Math.max(16, Math.min(anchor.y, window.innerHeight - 320)),
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 id={`${id}-title`} className={styles.cardTitle} style={{ padding: 0, fontSize: 15 }}>
          새 일정
        </h2>
        <button
          type="button"
          className={styles.timeChip}
          onClick={() => onDetails(draft)}
          aria-label={`${targetLabel(draft)}, 시간 바꾸기`}
        >
          {targetLabel(draft)} ▾
        </button>
        <label className={styles.field}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            한 줄 입력
          </span>
          <input
            className={styles.input}
            autoFocus
            autoComplete="off"
            placeholder="예: 점심 미팅, 14-15 고객 통화"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            // 한글 조합 중 Enter는 조합 확정이라 저장하지 않는다
            onKeyDown={(e) => e.key === 'Enter' && e.nativeEvent.isComposing && e.preventDefault()}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </label>
        {overridden && <p className={styles.muted}>입력한 시간으로 만들어요</p>}
        {error && (
          <p id={`${id}-error`} className={styles.fieldError}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.link} onClick={() => onDetails(draft)}>
            자세히
          </button>
          <button type="submit" className={styles.primary} disabled={create.isPending}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}

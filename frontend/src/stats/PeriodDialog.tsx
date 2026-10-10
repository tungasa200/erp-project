// 기간 고르기 (SCR-STAT-01 ① 직접 선택, 목업 STAT-01s ④). 캘린더의 모달 틀을 쓴다(포커스 가두기·Esc·돌려주기).
import { useId, useState } from 'react'
import { Modal } from '../calendar/Modal'
import type { Weekday } from '../calendar/time'
import { quickRanges, rangeError } from './period'
import calendarStyles from '../calendar/calendar.module.css'
import styles from './stats.module.css'

interface Props {
  from: string
  to: string
  today: string
  weekStart: Weekday
  onApply: (from: string, to: string) => void
  onClose: () => void
}

export function PeriodDialog({ from: initialFrom, to: initialTo, today, weekStart, onApply, onClose }: Props) {
  const id = useId()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  // 고치는 동안은 빨간 글자를 띄우지 않고, 적용을 누른 뒤부터 보인다
  const [submitted, setSubmitted] = useState(false)
  const error = rangeError(from, to)
  const shown = submitted ? error : null
  // 틀린 칸: 시작이 늦으면 시작일, 길이가 넘으면 종료일
  const badFrom = shown !== null && (!from || from > to)
  const badTo = shown !== null && !badFrom
  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} narrow>
      <h2 id={`${id}-title`} className={calendarStyles.title} style={{ fontSize: 18 }}>
        기간 고르기
      </h2>
      <form
        className={styles.periodForm}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(true)
          if (error === null) onApply(from, to)
        }}
      >
        <div role="group" aria-label="빠른 선택" className={styles.quickRanges}>
          {quickRanges(today, weekStart).map((r) => (
            <button
              key={r.label}
              type="button"
              className={styles.quickButton}
              aria-pressed={from === r.from && to === r.to}
              onClick={() => {
                setFrom(r.from)
                setTo(r.to)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className={styles.dateFields}>
          <label className={styles.field}>
            시작일
            <input
              type="date"
              value={from}
              max={to || undefined}
              required
              aria-invalid={badFrom || undefined}
              aria-describedby={badFrom ? `${id}-error` : undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            종료일
            <input
              type="date"
              value={to}
              min={from || undefined}
              required
              aria-invalid={badTo || undefined}
              aria-describedby={badTo ? `${id}-error` : undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <p id={`${id}-error`} role="alert" className={styles.fieldError}>
          {shown}
        </p>
        <div className={calendarStyles.actions}>
          <button type="button" className={calendarStyles.secondary} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={calendarStyles.primary}>
            적용
          </button>
        </div>
      </form>
    </Modal>
  )
}

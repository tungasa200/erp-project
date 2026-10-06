// 월 보기 (SCR-CAL-03): 6주 × 7일, 칸마다 일정 칩 3개 + "+n개 더보기". 칩을 끌어 다른 날짜로 옮긴다.
// 일지 상태 점(③)은 P2 데이터라 아직 없다.
import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { occurrenceKey, type Occurrence } from './api'
import { colorVars, type BlockColor } from './colors'
import { markFocus, occurrenceFocusId, restoreFocus } from './focus'
import { holidayName } from './holidays'
import { occurrencesByDate } from './layout'
import { RepeatIcon } from './TimeGrid'
import { WEEKDAY_LABELS, diffDays, formatMinutes, toZoned, weekdayIndex } from './time'
import styles from './calendar.module.css'

const MAX_CHIPS = 3
const DRAG_THRESHOLD = 4

interface Props {
  days: string[]
  month: string
  occurrences: Occurrence[]
  timeZone: string
  today: string
  colorOf: (o: Occurrence) => BlockColor | null
  onOpen: (o: Occurrence) => void
  onOpenDay: (date: string) => void
  onCreateAllDay: (date: string) => void
  onMoveDays: (o: Occurrence, days: number) => void
}

type Drag = { occurrence: Occurrence; from: string; over: string; x: number; y: number; moved: boolean }

function chipLabel(o: Occurrence, timeZone: string) {
  return o.allDay ? o.title : `${formatMinutes(toZoned(o.startAt!, timeZone).minutes)} ${o.title}`
}

export function MonthView({ days, month, occurrences, timeZone, today, colorOf, ...props }: Props) {
  const byDate = useMemo(() => occurrencesByDate(occurrences, days, timeZone), [occurrences, days, timeZone])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [popover, setPopover] = useState<{ date: string; x: number; y: number; opener: HTMLElement } | null>(null)

  useEffect(() => {
    if (!popover) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover(null)
    window.addEventListener('keydown', onKey)
    document.querySelector<HTMLElement>('[data-day-popover] button')?.focus()
    // 닫으면 "+n개 더보기"로 포커스를 돌린다
    const opener = popover.opener
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreFocus(markFocus(opener))
    }
  }, [popover])

  const dateAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-date]')?.dataset.date ?? null

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]')
    if (!chip) return
    const [date, key] = chip.dataset.chip!.split('#')
    const occurrence = byDate.get(date)?.find((o) => occurrenceKey(o) === key)
    if (!occurrence) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ occurrence, from: date, over: date, x: e.clientX, y: e.clientY, moved: false })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_THRESHOLD
    setDrag({ ...drag, moved, over: dateAt(e.clientX, e.clientY) ?? drag.over })
  }

  const onPointerUp = () => {
    if (!drag) return
    setDrag(null)
    if (!drag.moved) return props.onOpen(drag.occurrence)
    const shift = diffDays(drag.from, drag.over)
    if (shift) props.onMoveDays(drag.occurrence, shift)
  }

  const heads = days.slice(0, 7).map((d) => weekdayIndex(d))

  return (
    <div className={styles.monthWrap}>
      <div className={styles.monthGrid}>
        <div className={styles.monthHeads} aria-hidden="true">
          {heads.map((wd) => (
            <span key={wd} style={wd === 0 ? { color: 'var(--color-danger)' } : undefined}>
              {WEEKDAY_LABELS[wd]}
            </span>
          ))}
        </div>
        <div
          className={styles.monthCells}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          role="presentation"
        >
          {days.map((date) => {
            const list = byDate.get(date)!
            const holiday = holidayName(date)
            const wd = weekdayIndex(date)
            const shown = list.slice(0, list.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS)
            return (
              <div
                key={date}
                data-date={date}
                className={styles.monthCell}
                data-out={!date.startsWith(month) || undefined}
                data-today={date === today || undefined}
                data-holiday={!!holiday || undefined}
                data-rest={wd === 0 || wd === 6 || !!holiday || undefined}
                data-drop={(drag?.moved && drag.over === date) || undefined}
                onClick={(e) => e.target === e.currentTarget && props.onCreateAllDay(date)}
              >
                <div className={styles.monthCellHead}>
                  <button
                    type="button"
                    className={styles.dateNumber}
                    aria-label={`${date}${holiday ? ` ${holiday}` : ''} 일 보기`}
                    onClick={() => props.onOpenDay(date)}
                  >
                    {Number(date.slice(8))}
                  </button>
                  {holiday && <span className={styles.cellHoliday}>{holiday}</span>}
                </div>
                {shown.map((o) => (
                  <button
                    key={occurrenceKey(o)}
                    type="button"
                    data-chip={`${date}#${occurrenceKey(o)}`}
                    data-focus-id={occurrenceFocusId(o)}
                    className={styles.chip}
                    style={colorVars(colorOf(o))}
                    onClick={(e) => e.detail === 0 && props.onOpen(o)}
                  >
                    {o.recurring && <RepeatIcon />}
                    {chipLabel(o, timeZone)}
                  </button>
                ))}
                {list.length > shown.length && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setPopover({ date, x: rect.left, y: rect.bottom + 4, opener: e.currentTarget })
                    }}
                  >
                    +{list.length - shown.length}개 더보기
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {popover && (
        <div className={styles.popoverLayer} onPointerDown={(e) => e.target === e.currentTarget && setPopover(null)}>
          <div
            role="dialog"
            data-day-popover
            aria-label={`${popover.date} 일정`}
            className={styles.dayPopover}
            style={{
              left: Math.min(popover.x, window.innerWidth - 256),
              top: Math.min(popover.y, window.innerHeight - 300),
            }}
          >
            <h2 className={styles.cardTitle}>
              {Number(popover.date.slice(5, 7))}월 {Number(popover.date.slice(8))}일 (
              {WEEKDAY_LABELS[weekdayIndex(popover.date)]})
            </h2>
            {byDate.get(popover.date)!.map((o) => (
              <button
                key={occurrenceKey(o)}
                type="button"
                className={styles.chip}
                style={colorVars(colorOf(o))}
                onClick={() => {
                  setPopover(null)
                  props.onOpen(o)
                }}
              >
                {o.recurring && <RepeatIcon />}
                {chipLabel(o, timeZone)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

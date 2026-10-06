// 목록 보기 (SCR-CAL-05): 날짜별 그룹, 아래로 스크롤하면 기간을 늘려 계속 불러온다.
import { useEffect, useMemo, useRef } from 'react'
import { occurrenceKey, type Occurrence } from './api'
import { colorVars, type BlockColor } from './colors'
import { focusGroup, occurrenceFocusId } from './focus'
import { holidayName } from './holidays'
import { occurrencesByDate } from './layout'
import { RepeatIcon } from './TimeGrid'
import { WEEKDAY_LABELS, formatMinutes, toZoned, weekdayIndex } from './time'
import styles from './calendar.module.css'

interface Props {
  days: string[]
  occurrences: Occurrence[]
  timeZone: string
  today: string
  loading: boolean
  canLoadMore: boolean
  colorOf: (o: Occurrence) => BlockColor | null
  projectNameOf: (o: Occurrence) => string | null
  onOpen: (o: Occurrence) => void
  onLoadMore: () => void
}

function timeText(o: Occurrence, date: string, timeZone: string) {
  if (o.allDay) return '종일'
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  const start = s.date === date ? formatMinutes(s.minutes) : '00:00'
  const end = e.date === date ? formatMinutes(e.minutes) : '24:00'
  return `${start} – ${end}`
}

export function ListView({ days, occurrences, timeZone, today, colorOf, projectNameOf, onOpen, ...props }: Props) {
  const byDate = useMemo(() => occurrencesByDate(occurrences, days, timeZone), [occurrences, days, timeZone])
  const groups = days.filter((d) => byDate.get(d)!.length > 0)
  const sentinel = useRef<HTMLDivElement>(null)
  const { canLoadMore, loading, onLoadMore } = props

  useEffect(() => {
    const el = sentinel.current
    if (!el || !canLoadMore || loading || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && onLoadMore())
    observer.observe(el)
    return () => observer.disconnect()
  }, [canLoadMore, loading, onLoadMore])

  return (
    <div className={styles.list}>
      {!loading && groups.length === 0 && <p className={styles.empty}>다가오는 일정이 없어요</p>}
      {groups.map((date) => {
        const holiday = holidayName(date)
        const label = `${date === today ? '오늘 · ' : ''}${WEEKDAY_LABELS[weekdayIndex(date)]}${holiday ? ` · ${holiday}` : ''}`
        return (
          <section key={date} className={styles.listDay} aria-label={`${date} ${label}`}>
            <div
              className={styles.listDate}
              data-today={date === today || undefined}
              data-holiday={!!holiday || undefined}
            >
              <div className={styles.listDateNumber}>{Number(date.slice(8))}</div>
              <div className={styles.listDateLabel}>
                {date.slice(0, 7) !== today.slice(0, 7) && `${Number(date.slice(5, 7))}월 · `}
                {label}
              </div>
            </div>
            <div className={styles.listItems}>
              {byDate.get(date)!.map((o) => (
                <button
                  key={occurrenceKey(o)}
                  type="button"
                  className={styles.listItem}
                  style={colorVars(colorOf(o))}
                  data-focus-id={occurrenceFocusId(o)}
                  data-focus-group={focusGroup(o, date)}
                  onClick={() => onOpen(o)}
                >
                  <span className={styles.listTime}>{timeText(o, date, timeZone)}</span>
                  <span className={styles.listColor} />
                  <span className={styles.listTitle}>{o.title}</span>
                  {projectNameOf(o) && <span className={styles.listMeta}>{projectNameOf(o)}</span>}
                  {o.recurring && (
                    <span className={styles.listMeta}>
                      <RepeatIcon /> 반복
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )
      })}
      <div ref={sentinel} />
      {canLoadMore && (
        <p className={styles.listFoot}>
          {loading ? (
            '불러오는 중…'
          ) : (
            <button type="button" className={styles.link} onClick={onLoadMore}>
              더 불러오기
            </button>
          )}
        </p>
      )}
    </div>
  )
}

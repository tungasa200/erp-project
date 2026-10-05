// 연 보기 (SCR-CAL-04): 12개월 미니 달력, 날짜별 일정 밀도 3단계(없음 / 1~2개 / 3개 이상).
// ③ 표시 전환의 "일지 상태"는 P2 데이터라 아직 없다.
import { useMemo } from 'react'
import type { Occurrence } from './api'
import { holidayName } from './holidays'
import { occurrencesByDate } from './layout'
import { WEEKDAYS, WEEKDAY_LABELS, addDays, daysInMonth, weekdayIndex, type Weekday } from './time'
import styles from './calendar.module.css'

interface Props {
  year: number
  occurrences: Occurrence[]
  timeZone: string
  today: string
  weekStart: Weekday
  onOpenDay: (date: string) => void
  onOpenMonth: (date: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

export function YearView({ year, occurrences, timeZone, today, weekStart, onOpenDay, onOpenMonth }: Props) {
  const allDays = useMemo(() => {
    const first = `${year}-01-01`
    const length = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000)
    return Array.from({ length }, (_, i) => addDays(first, i))
  }, [year])
  const byDate = useMemo(() => occurrencesByDate(occurrences, allDays, timeZone), [occurrences, allDays, timeZone])
  const heads = Array.from({ length: 7 }, (_, i) => (WEEKDAYS.indexOf(weekStart) + i) % 7)

  return (
    <>
      <div className={styles.yearLegend}>
        <span>
          <span className={styles.legendDot} style={{ background: 'var(--color-accent-light)' }} />
          1~2개
        </span>
        <span>
          <span className={styles.legendDot} style={{ background: 'var(--color-accent)' }} />
          3개 이상
        </span>
        <span>
          <span style={{ color: 'var(--color-danger)' }}>■</span> 공휴일
        </span>
      </div>
      <div className={styles.yearGrid}>
        {Array.from({ length: 12 }, (_, m) => {
          const first = `${year}-${pad(m + 1)}-01`
          const lead = (weekdayIndex(first) - WEEKDAYS.indexOf(weekStart) + 7) % 7
          const len = daysInMonth(year, m + 1)
          const current = today.slice(0, 7) === first.slice(0, 7)
          return (
            <section key={m} className={styles.yearMonth} data-current={current || undefined} aria-label={`${m + 1}월`}>
              <button type="button" className={styles.yearMonthName} onClick={() => onOpenMonth(first)}>
                {m + 1}월
              </button>
              <div className={styles.miniHeads} aria-hidden="true">
                {heads.map((wd) => (
                  <span key={wd}>{WEEKDAY_LABELS[wd]}</span>
                ))}
              </div>
              <div className={styles.miniDays}>
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} />
                ))}
                {Array.from({ length: len }, (_, i) => {
                  const date = `${year}-${pad(m + 1)}-${pad(i + 1)}`
                  const count = byDate.get(date)?.length ?? 0
                  const level = count === 0 ? 0 : count < 3 ? 1 : 2
                  const holiday = holidayName(date)
                  return (
                    <button
                      key={date}
                      type="button"
                      className={styles.yearDay}
                      data-today={date === today || undefined}
                      data-holiday={!!holiday || weekdayIndex(date) === 0 || undefined}
                      aria-label={`${date}${holiday ? ` ${holiday}` : ''}, 일정 ${count}개`}
                      onClick={() => onOpenDay(date)}
                    >
                      <span>{i + 1}</span>
                      <span className={styles.densityDot} data-level={level} />
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

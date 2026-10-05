// 좌측 미니 달력 (SCR-CAL-01 ②). 보고 있는 기간(주 보기는 그 주)을 강조하고, 날짜를 누르면 그 날짜로 간다.
import { useState } from 'react'
import { holidayName } from './holidays'
import { WEEKDAYS, WEEKDAY_LABELS, addDays, addMonths, monthGridStart, startOfMonth, type Weekday } from './time'
import styles from './calendar.module.css'

interface Props {
  /** 보고 있는 날짜 */
  date: string
  today: string
  weekStart: Weekday
  /** 강조할 날짜 범위 [첫날, 마지막 날] */
  highlight: [string, string] | null
  onSelect: (date: string) => void
}

export function MiniCalendar({ date, today, weekStart, highlight, onSelect }: Props) {
  // 보고 있는 날짜가 바뀌면 그 달로 돌아간다
  const [shown, setShown] = useState({ base: date, month: startOfMonth(date) })
  const month = shown.base === date ? shown.month : startOfMonth(date)
  const setMonth = (m: string) => setShown({ base: date, month: m })

  const start = monthGridStart(month, weekStart)
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const heads = Array.from({ length: 7 }, (_, i) => (WEEKDAYS.indexOf(weekStart) + i) % 7)
  const [y, m] = month.split('-').map(Number)

  return (
    <section className={styles.card} aria-label="미니 달력">
      <div className={styles.miniHead}>
        <h2>
          {y}년 {m}월
        </h2>
        <button
          type="button"
          className={styles.miniNav}
          aria-label="이전 달"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.miniNav}
          aria-label="다음 달"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>
      <div className={styles.miniHeads} aria-hidden="true">
        {heads.map((wd) => (
          <span key={wd}>{WEEKDAY_LABELS[wd]}</span>
        ))}
      </div>
      {weeks
        .filter((week, i) => i < 5 || week[0].startsWith(month.slice(0, 7)))
        .map((week) => (
          <div
            key={week[0]}
            className={`${styles.miniDays} ${styles.miniWeek}`}
            data-current={(highlight && week[0] <= highlight[1] && week[6] >= highlight[0]) || undefined}
          >
            {week.map((d) => (
              <button
                key={d}
                type="button"
                className={styles.miniDay}
                data-out={!d.startsWith(month.slice(0, 7)) || undefined}
                data-today={d === today || undefined}
                data-holiday={!!holidayName(d) || undefined}
                aria-label={d}
                aria-current={d === date ? 'date' : undefined}
                onClick={() => onSelect(d)}
              >
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
        ))}
    </section>
  )
}

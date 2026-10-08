// SCR-CAL-02 ④ 일 보기 실제 열 (D-105, 시간 기록 옵션 켜짐). 계획 열(그 날짜 칸) 옆에 그날의 시간 기록을 그린다.
// 규칙은 홈 오늘 타임라인 두 열(SCR-HOME-01 ③, P2-08)과 같다: 실제 = 시작 시각이 있는 확정 기록(실행 중 타이머는 지금까지),
// 빈 구간(15분 이상, 서버 계산)은 버튼이고 누르면 SCR-HOME-03, 열 머리에 그날 합계. 기록 블록을 누르면 SCR-REC-01(지난 기록 고치기).
// 오프라인이면 빈 구간 채우기는 끄고 기록은 열어 보게 둔다(일정 만들기와 같은 규칙).
import { useState, type CSSProperties } from 'react'
import { durationText, useTimeGaps, useTimeSummary, type TimeGap } from '../home/gaps'
import { GapFill } from '../home/GapFill'
import { actualEntries, packLanes } from '../home/timeline'
import { useProjects } from '../projects/api'
import { projectColor } from '../projects/palette'
import type { WorkRecord } from '../records/api'
import { colorVars } from './colors'
import { drawnRange, MIN_BLOCK_MINUTES } from './layout'
import { useRecordsOnDate } from './recordStatus'
import { formatMinutes, MINUTES_PER_DAY, toZoned } from './time'
import styles from './dayActual.module.css'

const NO_GAPS: TimeGap[] = []
const endText = (m: number) => (m >= MINUTES_PER_DAY ? '24:00' : formatMinutes(m))

/** 실제 열 머리: "실제 · 3시간 30분"(확정 기록 합계) */
export function DayActualHead({ date }: { date: string }) {
  const total = useTimeSummary(date, date).data?.totalMin
  return (
    <span className={styles.head}>
      실제{total ? <span className={styles.total}> · {durationText(total)}</span> : null}
    </span>
  )
}

interface Props {
  date: string
  timeZone: string
  now: number
  /** 그리드와 같은 축척 */
  pxPerMinute: number
  editable: boolean
  onOpenRecord: (record: WorkRecord) => void
}

export function DayActualColumn({ date, timeZone, now, pxPerMinute, editable, onOpenRecord }: Props) {
  const records = useRecordsOnDate(date)
  const gapsQuery = useTimeGaps(date, true)
  const gaps = gapsQuery.data ?? NO_GAPS
  const projects = useProjects()
  const [filling, setFilling] = useState<TimeGap | null>(null)
  const actual = actualEntries(records.data ?? [], date, timeZone, now)
  const total = useTimeSummary(date, date).data?.totalMin
  const nowZoned = toZoned(now, timeZone)

  const colorOf = (projectId: string | null | undefined) => {
    const p = projectId ? projects.data?.find((x) => x.id === projectId) : undefined
    return p ? projectColor(p.color) : null
  }
  const place = (start: number, end: number, lane = 0, lanes = 1): CSSProperties => {
    const [s, e] = drawnRange(start, end)
    return {
      top: s * pxPerMinute + 1,
      height: (e - s) * pxPerMinute - 2,
      left: `calc(${(lane / lanes) * 100}% + 2px)`,
      width: `calc(${100 / lanes}% - 4px)`,
    }
  }
  const gapSpans = gaps.map((gap) => {
    const s = toZoned(gap.startAt, timeZone)
    const e = toZoned(gap.endAt, timeZone)
    return { gap, start: s.minutes, end: e.date !== s.date ? MINUTES_PER_DAY : e.minutes }
  })
  const empty = records.isSuccess && actual.timed.length === 0 && gapsQuery.isSuccess && gaps.length === 0

  return (
    <div className={styles.column} aria-label={total ? `실제, ${durationText(total)}` : '실제'} role="group">
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className={styles.hourLine} style={{ top: h * 60 * pxPerMinute }} aria-hidden="true" />
      ))}
      {/* 빈 구간을 먼저 그려 겹치면 기록 블록이 위에 온다 */}
      {gapSpans.map(({ gap, start, end }) => {
        const label = `빈 시간 ${formatMinutes(start)}–${endText(end)}, ${durationText(gap.minutes)}${editable ? ', 눌러서 채우기' : ', 연결되면 채울 수 있어요'}`
        return (
          <button
            key={gap.startAt}
            type="button"
            className={styles.gap}
            style={place(start, end)}
            data-focus-id={`gap:${gap.startAt}`}
            aria-haspopup="dialog"
            aria-label={label}
            title={label}
            disabled={!editable}
            onClick={() => setFilling(gap)}
          >
            <span className={styles.title}>빈 시간</span>
            <span className={styles.tag}>{durationText(gap.minutes)}</span>
          </button>
        )
      })}
      {packLanes(actual.timed, MIN_BLOCK_MINUTES).map(({ item: a, lane, lanes }) => {
        const time = `${formatMinutes(a.start)}–${a.running ? '지금' : endText(a.end)}`
        const label = `${a.record.content}, ${time}${a.running ? ', 진행 중' : ''}`
        const [s, e] = drawnRange(a.start, a.end)
        return (
          <button
            key={a.record.id}
            type="button"
            className={styles.record}
            data-running={a.running || undefined}
            data-focus-id={`record:${a.record.id}`}
            style={{ ...place(a.start, a.end, lane, lanes), ...colorVars(colorOf(a.record.projectId)) }}
            aria-haspopup="dialog"
            aria-label={label}
            title={label}
            onClick={() => onOpenRecord(a.record)}
          >
            <span className={styles.title}>{a.record.content}</span>
            {a.running ? (
              <span className={styles.tag}>진행 중</span>
            ) : (
              (e - s) * pxPerMinute >= 34 && <span className={styles.time}>{time}</span>
            )}
          </button>
        )
      })}
      {/* 그리드가 처음 8시로 스크롤되므로 그 자리에 둔다 */}
      {empty && (
        <p className={styles.empty} style={{ top: 8 * 60 * pxPerMinute + 6 }}>
          시간을 남긴 기록이 없어요
        </p>
      )}
      {date === nowZoned.date && (
        <div className={styles.nowLine} style={{ top: nowZoned.minutes * pxPerMinute }} aria-hidden="true" />
      )}
      {filling && <GapFill gap={filling} timeZone={timeZone} onClose={() => setFilling(null)} />}
    </div>
  )
}

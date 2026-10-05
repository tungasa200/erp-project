// 일·주 보기 시간 그리드 (SCR-CAL-01·02). 빈 칸 클릭·드래그로 만들기, 블록 드래그로 옮기기, 아래 끝으로 길이 조절.
// 드래그는 라이브러리 없이 pointer 이벤트로 하고 15분 단위로 맞춘다(SCH-04). 키보드로는 블록을 열어 상세에서 시간을 바꾼다.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react'
import { occurrenceKey, type Occurrence } from './api'
import { colorVars, type BlockColor } from './colors'
import { holidayName } from './holidays'
import { allDayBars, timedSegments, type TimedSegment } from './layout'
import type { TimeChange } from './useScheduleActions'
import {
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  WEEKDAY_LABELS,
  addDays,
  formatMinutes,
  fromZoned,
  toZoned,
  weekdayIndex,
} from './time'
import styles from './calendar.module.css'

const HOUR_HEIGHT = 48
const PX_PER_MINUTE = HOUR_HEIGHT / 60
const DEFAULT_SCROLL_HOUR = 8
const DRAG_THRESHOLD = 4
export const TASK_DRAG_TYPE = 'application/x-worklog-task'

export interface TimeRange {
  date: string
  start: number
  end: number
}

interface Props {
  days: string[]
  occurrences: Occurrence[]
  timeZone: string
  today: string
  now: number
  colorOf: (o: Occurrence) => BlockColor | null
  /** 빠른 생성 중인 임시 블록 */
  pending: TimeRange | null
  onCreate: (range: TimeRange) => void
  onCreateAllDay: (date: string) => void
  onOpen: (o: Occurrence) => void
  onMove: (o: Occurrence, change: TimeChange) => void
  onOpenDay?: (date: string) => void
  /** 업무 패널에서 끌어 놓기(SCR-CAL-09): 1시간 일정 */
  onDropTask?: (taskId: string, range: TimeRange) => void
}

type Drag =
  | { kind: 'create'; dayIndex: number; anchor: number; current: number; x: number; y: number; moved: boolean }
  | {
      kind: 'move'
      segment: TimedSegment
      dayIndex: number
      anchor: number
      deltaDays: number
      deltaMinutes: number
      x: number
      y: number
      moved: boolean
    }
  | { kind: 'resize'; segment: TimedSegment; end: number }
  | { kind: 'moveAllDay'; occurrence: Occurrence; anchorDay: number; deltaDays: number; x: number; moved: boolean }

const floorSlot = (m: number) =>
  Math.max(0, Math.min(MINUTES_PER_DAY - SLOT_MINUTES, Math.floor(m / SLOT_MINUTES) * SLOT_MINUTES))
const roundSlot = (m: number) => Math.round(m / SLOT_MINUTES) * SLOT_MINUTES

function blockStyle(color: BlockColor | null, top: number, height: number, column = 0, columns = 1): CSSProperties {
  return {
    top,
    height,
    left: `calc(${(column / columns) * 100}% + 2px)`,
    width: `calc(${100 / columns}% - 4px)`,
    ...colorVars(color),
  }
}

function timeLabel(o: Occurrence, timeZone: string) {
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  return `${formatMinutes(s.minutes)}–${formatMinutes(e.minutes)}`
}

export function TimeGrid(props: Props) {
  const { days, occurrences, timeZone, today, now, colorOf, pending } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const allDayRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [taskHover, setTaskHover] = useState<TimeRange | null>(null)

  const segments = useMemo(() => timedSegments(occurrences, days, timeZone), [occurrences, days, timeZone])
  const bars = useMemo(() => allDayBars(occurrences, days), [occurrences, days])
  const allDayRows = Math.max(1, ...bars.map((b) => b.row + 1))
  const nowZoned = toZoned(now, timeZone)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT
  }, [])

  // 드래그 중 Esc는 취소
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  /** 화면 좌표 → 날짜 칸 번호·분 */
  const locate = (clientX: number, clientY: number) => {
    const el = columnsRef.current!
    const rect = el.getBoundingClientRect()
    const dayIndex = Math.max(
      0,
      Math.min(days.length - 1, Math.floor(((clientX - rect.left) / rect.width) * days.length)),
    )
    const minutes = Math.max(0, Math.min(MINUTES_PER_DAY, (clientY - rect.top) / PX_PER_MINUTE))
    return { dayIndex, minutes }
  }

  const locateAllDay = (clientX: number) => {
    const rect = allDayRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - rect.left) / rect.width) * days.length)))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const blockEl = target.closest<HTMLElement>('[data-segment]')
    const { dayIndex, minutes } = locate(e.clientX, e.clientY)
    if (blockEl) {
      const [date, key] = blockEl.dataset.segment!.split('#')
      const segment = segments.get(date)?.find((s) => occurrenceKey(s.occurrence) === key)
      if (!segment) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      if (target.dataset.handle === 'resize') setDrag({ kind: 'resize', segment, end: segment.end })
      else
        setDrag({
          kind: 'move',
          segment,
          dayIndex,
          anchor: minutes,
          deltaDays: 0,
          deltaMinutes: 0,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const slot = floorSlot(minutes)
    setDrag({ kind: 'create', dayIndex, anchor: slot, current: slot, x: e.clientX, y: e.clientY, moved: false })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.kind === 'moveAllDay') return
    const { dayIndex, minutes } = locate(e.clientX, e.clientY)
    if (drag.kind === 'create') {
      const moved = drag.moved || Math.abs(e.clientY - drag.y) > DRAG_THRESHOLD
      setDrag({ ...drag, current: floorSlot(minutes), moved })
    } else if (drag.kind === 'move') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_THRESHOLD
      setDrag({
        ...drag,
        moved,
        deltaDays: dayIndex - drag.dayIndex,
        deltaMinutes: roundSlot(minutes - drag.anchor),
      })
    } else {
      const min = drag.segment.start + SLOT_MINUTES
      setDrag({ ...drag, end: Math.max(min, Math.min(MINUTES_PER_DAY, roundSlot(minutes))) })
    }
  }

  const onPointerUp = () => {
    if (!drag || drag.kind === 'moveAllDay') return
    setDrag(null)
    if (drag.kind === 'create') {
      const date = days[drag.dayIndex]
      if (!drag.moved) {
        props.onCreate({ date, start: drag.anchor, end: Math.min(MINUTES_PER_DAY, drag.anchor + 60) })
      } else {
        const start = Math.min(drag.anchor, drag.current)
        const end = Math.max(drag.anchor, drag.current) + SLOT_MINUTES
        props.onCreate({ date, start, end })
      }
    } else if (drag.kind === 'move') {
      const o = drag.segment.occurrence
      if (!drag.moved) return props.onOpen(o)
      if (drag.deltaDays === 0 && drag.deltaMinutes === 0) return
      const s = toZoned(o.startAt!, timeZone)
      const total = s.minutes + drag.deltaMinutes
      const startAt = fromZoned(
        addDays(s.date, drag.deltaDays + Math.floor(total / MINUTES_PER_DAY)),
        ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
        timeZone,
      )
      const duration = Date.parse(o.endAt!) - Date.parse(o.startAt!)
      props.onMove(o, { startAt, endAt: new Date(Date.parse(startAt) + duration).toISOString() })
    } else {
      const o = drag.segment.occurrence
      if (drag.end === drag.segment.end) return
      props.onMove(o, { startAt: o.startAt!, endAt: fromZoned(drag.segment.date, drag.end, timeZone) })
    }
  }

  // ── 종일 행

  const onAllDayPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const barEl = (e.target as HTMLElement).closest<HTMLElement>('[data-bar]')
    const dayIndex = locateAllDay(e.clientX)
    if (!barEl) return props.onCreateAllDay(days[dayIndex])
    const bar = bars.find((b) => occurrenceKey(b.occurrence) === barEl.dataset.bar)
    if (!bar) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      kind: 'moveAllDay',
      occurrence: bar.occurrence,
      anchorDay: dayIndex,
      deltaDays: 0,
      x: e.clientX,
      moved: false,
    })
  }

  const onAllDayPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag?.kind !== 'moveAllDay') return
    const moved = drag.moved || Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD
    setDrag({ ...drag, moved, deltaDays: locateAllDay(e.clientX) - drag.anchorDay })
  }

  const onAllDayPointerUp = () => {
    if (drag?.kind !== 'moveAllDay') return
    setDrag(null)
    const o = drag.occurrence
    if (!drag.moved) return props.onOpen(o)
    if (drag.deltaDays === 0) return
    props.onMove(o, { startDate: addDays(o.startDate!, drag.deltaDays), endDate: addDays(o.endDate!, drag.deltaDays) })
  }

  // ── 업무 끌어 놓기 (P1-08)

  const taskRange = (e: DragEvent): TimeRange | null => {
    if (!props.onDropTask || !e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return null
    const { dayIndex, minutes } = locate(e.clientX, e.clientY)
    const start = Math.min(floorSlot(minutes), MINUTES_PER_DAY - 60)
    return { date: days[dayIndex], start, end: start + 60 }
  }

  const onDragOver = (e: DragEvent) => {
    const range = taskRange(e)
    if (!range) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (range.date !== taskHover?.date || range.start !== taskHover.start) setTaskHover(range)
  }

  const onDrop = (e: DragEvent) => {
    const range = taskRange(e)
    setTaskHover(null)
    if (!range) return
    e.preventDefault()
    props.onDropTask!(e.dataTransfer.getData(TASK_DRAG_TYPE), range)
  }

  // ── 그리기

  const preview: (TimeRange & { label?: string }) | null =
    drag?.kind === 'create'
      ? {
          date: days[drag.dayIndex],
          start: drag.moved ? Math.min(drag.anchor, drag.current) : drag.anchor,
          end: drag.moved ? Math.max(drag.anchor, drag.current) + SLOT_MINUTES : drag.anchor + 60,
        }
      : (taskHover ?? pending)

  const columns = `repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div className={styles.timeGrid}>
      <div className={styles.dayHeads} style={{ gridTemplateColumns: columns }}>
        {days.map((date) => {
          const holiday = holidayName(date)
          const wd = weekdayIndex(date)
          const label = `${WEEKDAY_LABELS[wd]} ${Number(date.slice(8))}`
          return (
            <div key={date} className={styles.dayHead}>
              <button
                type="button"
                className={styles.dayHeadButton}
                data-today={date === today || undefined}
                data-holiday={!!holiday || undefined}
                data-weekend={wd === 0 || wd === 6 || undefined}
                aria-label={`${date}${holiday ? ` ${holiday}` : ''} 일 보기`}
                onClick={() => props.onOpenDay?.(date)}
                disabled={!props.onOpenDay}
              >
                <span className={styles.dayHeadName}>{label.split(' ')[0]}</span>
                <span className={styles.dayHeadNumber}>{label.split(' ')[1]}</span>
              </button>
              {holiday && <span className={styles.holidayTag}>{holiday}</span>}
            </div>
          )
        })}
      </div>

      <div className={styles.allDayRow}>
        <span className={styles.allDayLabel}>종일</span>
        <div
          ref={allDayRef}
          className={styles.allDayCells}
          style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${allDayRows}, 24px)` }}
          onPointerDown={onAllDayPointerDown}
          onPointerMove={onAllDayPointerMove}
          onPointerUp={onAllDayPointerUp}
          onPointerCancel={() => setDrag(null)}
          role="presentation"
        >
          {bars.map((bar) => {
            const shift = drag?.kind === 'moveAllDay' && drag.occurrence === bar.occurrence ? drag.deltaDays : 0
            const start = Math.max(0, bar.startIndex + shift)
            const end = Math.min(days.length, bar.startIndex + bar.span + shift)
            if (end <= start) return null
            const color = colorOf(bar.occurrence)
            return (
              <button
                key={occurrenceKey(bar.occurrence)}
                type="button"
                data-bar={occurrenceKey(bar.occurrence)}
                className={styles.allDayBar}
                data-dragging={shift !== 0 || undefined}
                style={{
                  gridColumn: `${start + 1} / ${end + 1}`,
                  gridRow: bar.row + 1,
                  ...colorVars(color),
                }}
                // 마우스는 pointer 처리에서 연다. 키보드(Enter·Space)로 누른 click만 여기서 연다
                onClick={(e) => e.detail === 0 && props.onOpen(bar.occurrence)}
              >
                {bar.occurrence.recurring && <RepeatIcon />}
                {bar.occurrence.title}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={scrollRef} className={styles.gridScroll}>
        <div className={styles.gridBody} style={{ height: 24 * HOUR_HEIGHT }}>
          <div className={styles.hourLabels} aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: (i + 1) * HOUR_HEIGHT - 7 }}>
                {formatMinutes((i + 1) * 60)}
              </span>
            ))}
          </div>
          <div
            ref={columnsRef}
            className={styles.columns}
            style={{ gridTemplateColumns: columns }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onDragOver={onDragOver}
            onDragLeave={() => setTaskHover(null)}
            onDrop={onDrop}
            role="presentation"
          >
            {days.map((date) => {
              const wd = weekdayIndex(date)
              return (
                <div
                  key={date}
                  className={styles.column}
                  data-today={date === today || undefined}
                  data-rest={wd === 0 || wd === 6 || !!holidayName(date) || undefined}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className={styles.hourLine} style={{ top: h * HOUR_HEIGHT }} />
                  ))}
                  {segments.get(date)!.map((segment) => (
                    <Block
                      key={occurrenceKey(segment.occurrence)}
                      segment={segment}
                      color={colorOf(segment.occurrence)}
                      timeZone={timeZone}
                      now={now}
                      drag={drag}
                      onOpen={props.onOpen}
                    />
                  ))}
                  {drag?.kind === 'move' && drag.moved && (
                    <MoveGhost drag={drag} date={date} days={days} color={colorOf(drag.segment.occurrence)} />
                  )}
                  {preview && preview.date === date && (
                    <div
                      className={styles.pendingBlock}
                      style={blockStyle(
                        null,
                        preview.start * PX_PER_MINUTE,
                        (preview.end - preview.start) * PX_PER_MINUTE,
                      )}
                    >
                      <strong>(제목 없음)</strong>
                      <span>
                        {formatMinutes(preview.start)}–{formatMinutes(preview.end)}
                      </span>
                    </div>
                  )}
                  {date === nowZoned.date && (
                    <div className={styles.nowLine} style={{ top: nowZoned.minutes * PX_PER_MINUTE }}>
                      <span>{formatMinutes(nowZoned.minutes)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Block({
  segment,
  color,
  timeZone,
  now,
  drag,
  onOpen,
}: {
  segment: TimedSegment
  color: BlockColor | null
  timeZone: string
  now: number
  drag: Drag | null
  onOpen: (o: Occurrence) => void
}) {
  const o = segment.occurrence
  const end = drag?.kind === 'resize' && drag.segment === segment ? drag.end : segment.end
  const height = Math.max(SLOT_MINUTES, end - segment.start) * PX_PER_MINUTE - 2
  const active = Date.parse(o.startAt!) <= now && now < Date.parse(o.endAt!)
  const dragging = drag?.kind === 'move' && drag.moved && drag.segment.occurrence === o
  return (
    <button
      type="button"
      data-segment={`${segment.date}#${occurrenceKey(o)}`}
      className={styles.block}
      data-now={active || undefined}
      data-dragging={dragging || undefined}
      style={blockStyle(color, segment.start * PX_PER_MINUTE + 1, height, segment.column, segment.columns)}
      onClick={(e) => e.detail === 0 && onOpen(o)}
      aria-label={`${o.title}, ${timeLabel(o, timeZone)}${o.recurring ? ', 반복' : ''}`}
    >
      <span className={styles.blockTitle}>
        {o.recurring && <RepeatIcon />}
        {o.title}
      </span>
      {height >= 34 && <span className={styles.blockTime}>{timeLabel(o, timeZone)}</span>}
      {!segment.continuesAfter && <span className={styles.resizeHandle} data-handle="resize" aria-hidden="true" />}
    </button>
  )
}

/** 옮기는 중인 블록의 새 자리. 원래 시작 날짜 칸 기준으로 날짜·분을 더한다 */
function MoveGhost({
  drag,
  date,
  days,
  color,
}: {
  drag: Extract<Drag, { kind: 'move' }>
  date: string
  days: string[]
  color: BlockColor | null
}) {
  const seg = drag.segment
  const targetIndex = days.indexOf(seg.date) + drag.deltaDays
  if (days[targetIndex] !== date) return null
  const start = Math.max(0, Math.min(MINUTES_PER_DAY - SLOT_MINUTES, seg.start + drag.deltaMinutes))
  const end = Math.min(MINUTES_PER_DAY, start + (seg.end - seg.start))
  return (
    <div
      className={styles.ghostBlock}
      style={blockStyle(color, start * PX_PER_MINUTE + 1, (end - start) * PX_PER_MINUTE - 2)}
      aria-hidden="true"
    >
      <strong>{seg.occurrence.title}</strong>
      <span>
        {formatMinutes(start)}–{formatMinutes(end)}
      </span>
    </div>
  )
}

export function RepeatIcon() {
  return (
    <svg
      className={styles.repeatIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  )
}

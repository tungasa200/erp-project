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
  type ReactNode,
} from 'react'
import { occurrenceKey, type Occurrence } from './api'
import { colorVars, type BlockColor } from './colors'
import { cycleTab, focusGroup, markFocus, occurrenceFocusId, restoreFocus } from './focus'
import { holidayName } from './holidays'
import {
  allDayBars,
  MORE_PX,
  capColumns,
  drawnRange,
  timedSegments,
  type CappedSegment,
  type MoreGroup,
  type TimedSegment,
} from './layout'
import { useTouchHold } from './touchHold'
import type { TimeChange } from './useScheduleActions'
import {
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  WEEKDAY_LABELS,
  addDays,
  dateName,
  formatMinutes,
  fromZoned,
  minutesRange,
  toZoned,
  weekdayIndex,
} from './time'
import styles from './calendar.module.css'
import actualStyles from './dayActual.module.css'

const HOUR_HEIGHT = 48
export const PX_PER_MINUTE = HOUR_HEIGHT / 60
const DEFAULT_SCROLL_HOUR = 8
/** 처음 보이는 시각 라벨(08:00)이 위 경계에 잘리지 않게 남기는 여백(UX-CAL-73) */
const LABEL_ROOM = 12
const DRAG_THRESHOLD = 4
/** 끄는 손가락·커서가 스크롤 영역 위아래 이 거리 안에 들면 그쪽으로 저절로 스크롤한다(UX-CAL-94) */
const EDGE_ZONE = 40
/** 가장자리 끝에서의 한 프레임 스크롤 양. 가장자리에 가까울수록 빨라진다 */
const EDGE_MAX_SPEED = 12
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
  /** 모바일 주 보기: 훑어보기 전용(D-77). 하루 칸 전체가 일 보기로 가는 버튼이고 블록 누름·끌기·만들기는 끈다 */
  overview?: boolean
  /** false면(오프라인, P1-X-04) 끌기·길이 조절·빈 칸 만들기·업무 끌어 놓기를 끈다. 보기는 그대로 */
  editable?: boolean
  /** 늘어날 때마다 오늘이 보이는 기간이면 현재 시각선이 화면 안에 들게 스크롤한다([오늘]·T, UX-CAL-74) */
  nowSignal?: number
  /** 일 보기 실제 열(SCR-CAL-02 ④, 시간 기록 옵션 켜짐). 있으면 날짜 칸을 왼쪽 반(계획)으로 줄이고 오른쪽 반에 그린다 */
  actual?: { head: ReactNode; column: ReactNode }
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

/** reserve: 오른쪽에 떼어 둔 "+n" 자리(px). 블록은 그 왼쪽 폭을 열 수로 나눈다(UX-CAL-171) */
function blockStyle(
  color: BlockColor | null,
  top: number,
  height: number,
  column = 0,
  columns = 1,
  reserve = 0,
): CSSProperties {
  return {
    top,
    height,
    left: `calc((100% - ${reserve}px) * ${column / columns} + 2px)`,
    width: `calc((100% - ${reserve}px) / ${columns} - 4px)`,
    ...colorVars(color),
  }
}

function timeLabel(o: Occurrence, timeZone: string) {
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  return minutesRange(s.minutes, e.minutes)
}

export function TimeGrid(props: Props) {
  const { days, occurrences, timeZone, today, now, colorOf, pending, overview = false, editable = true } = props
  // 훑어보기·오프라인이면 그리드에서 바꾸는 동작을 받지 않는다
  const readOnly = overview || !editable
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const allDayRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [taskHover, setTaskHover] = useState<TimeRange | null>(null)
  // 손가락은 길게 누른 뒤에만 끈다(바로 밀면 스크롤)
  const gridHold = useTouchHold(columnsRef)
  const allDayHold = useTouchHold(allDayRef)

  const segments = useMemo(() => timedSegments(occurrences, days, timeZone), [occurrences, days, timeZone])
  // 겹침 상한: 열 폭이 MIN_BLOCK_PX보다 좁아지면 앞 열만 그리고 오른쪽 "+n"으로(CAL-70, UX-CAL-171·172). 폭을 모르면(jsdom) 상한 없음
  const [dayWidth, setDayWidth] = useState(0)
  useLayoutEffect(() => {
    const el = columnsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setDayWidth(el.clientWidth / days.length))
    observer.observe(el)
    return () => observer.disconnect()
  }, [days.length])
  const capped = useMemo(
    () => new Map([...segments].map(([date, list]) => [date, capColumns(list, dayWidth)])),
    [segments, dayWidth],
  )
  const [morePopover, setMorePopover] = useState<{ group: MoreGroup; opener: HTMLElement } | null>(null)
  const bars = useMemo(() => allDayBars(occurrences, days), [occurrences, days])
  const allDayRows = Math.max(1, ...bars.map((b) => b.row + 1))
  const nowZoned = toZoned(now, timeZone)

  // 처음에는 08시부터 보인다. 오늘이 든 기간인데 지금이 그 밖(이른 아침·늦은 밤)이면 지금 한 시간 전부터(UX-CAL-74)
  // 효과는 처음과 [오늘]에만 돌므로 그 순간의 값을 ref로 읽는다
  const nowView = useRef({ showsToday: false, nowTop: 0 })
  nowView.current = { showsToday: days.includes(today), nowTop: nowZoned.minutes * PX_PER_MINUTE }
  const firstScroll = useRef(true)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = firstScroll.current
    firstScroll.current = false
    const top = first ? DEFAULT_SCROLL_HOUR * HOUR_HEIGHT - LABEL_ROOM : el.scrollTop
    // 높이를 모를 때(그리기 전)는 기본 범위 08~19시로 본다
    const height = el.clientHeight || 11 * HOUR_HEIGHT
    const { showsToday, nowTop } = nowView.current
    const nowHidden = nowTop < top || nowTop > top + height - HOUR_HEIGHT / 2
    el.scrollTop = showsToday && nowHidden ? Math.max(0, nowTop - HOUR_HEIGHT) : top
    // 기간을 넘기거나 시각이 흘러도 스크롤은 그대로 둔다. 처음과 [오늘]을 누를 때만
  }, [props.nowSignal])

  // 드래그 중 Esc는 취소
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  /** 화면 좌표 → 날짜 칸 번호·분·칸 안 가로 위치(0~1) */
  const locate = (clientX: number, clientY: number) => {
    const el = columnsRef.current!
    const rect = el.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * days.length
    const dayIndex = Math.max(0, Math.min(days.length - 1, Math.floor(x)))
    const minutes = Math.max(0, Math.min(MINUTES_PER_DAY, (clientY - rect.top) / PX_PER_MINUTE))
    return { dayIndex, minutes, xInDay: x - dayIndex }
  }

  /** 블록이 그려진 범위 안이지만 블록 밖인 곳(블록 사이 틈). 누름을 빈 칸으로 받으면 24px 간격 예외가 깨진다(D-76) */
  const inBlockGap = (dayIndex: number, minutes: number, xInDay: number) =>
    capped.get(days[dayIndex])!.visible.some((s) => {
      const [start, end] = drawnRange(s.start, s.end)
      // "+n" 자리를 뗀 블록은 칸 폭에서 그만큼 뺀 비율로 잰다
      const span = s.reserve && dayWidth ? 1 - s.reserve / dayWidth : 1
      return (
        minutes >= start &&
        minutes <= end &&
        xInDay >= (s.column / s.columns) * span &&
        xInDay <= ((s.column + 1) / s.columns) * span
      )
    })

  const locateAllDay = (clientX: number) => {
    const rect = allDayRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - rect.left) / rect.width) * days.length)))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // "+n"은 누르면 팝오버를 연다(빈 칸 만들기로 받지 않는다)
    if (target.closest('[data-more]')) return
    const blockEl = target.closest<HTMLElement>('[data-segment]')
    const { dayIndex, minutes, xInDay } = locate(e.clientX, e.clientY)
    if (blockEl) {
      const [date, key] = blockEl.dataset.segment!.split('#')
      const segment = segments.get(date)?.find((s) => occurrenceKey(s.occurrence) === key)
      if (!segment) return
      const next: Drag =
        target.dataset.handle === 'resize'
          ? { kind: 'resize', segment, end: segment.end }
          : {
              kind: 'move',
              segment,
              dayIndex,
              anchor: minutes,
              deltaDays: 0,
              deltaMinutes: 0,
              x: e.clientX,
              y: e.clientY,
              moved: false,
            }
      // 손가락: 짧게 누르면 열고, 길게 누르면 옮기기·늘리기. 기본 동작을 막지 않아야 블록 위에서 밀어도 스크롤된다
      const focusBlock = () => blockEl.focus({ preventScroll: true })
      const touch = gridHold.start(
        e,
        () => {
          focusBlock()
          setDrag(next)
        },
        () => {
          focusBlock()
          props.onOpen(segment.occurrence)
        },
      )
      if (touch) return
      // 끌기를 위해 기본 동작을 막으면 블록이 포커스를 받지 못한다. 직접 옮겨 두어야 연 창을 닫을 때 이 블록으로 돌아온다
      e.preventDefault()
      focusBlock()
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag(next)
      return
    }
    if (inBlockGap(dayIndex, minutes, xInDay)) return
    const slot = floorSlot(minutes)
    const next: Drag = {
      kind: 'create',
      dayIndex,
      anchor: slot,
      current: slot,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    }
    // 손가락: 짧게 누르면 그 칸에서 1시간 만들기(클릭과 같음), 길게 누른 뒤 끌면 범위 만들기
    const touch = gridHold.start(
      e,
      () => setDrag(next),
      () => props.onCreate({ date: days[dayIndex], start: slot, end: Math.min(MINUTES_PER_DAY, slot + 60) }),
    )
    if (touch) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(next)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (gridHold.move(e)) return
    if (!drag || drag.kind === 'moveAllDay') return
    pointer.current = { x: e.clientX, y: e.clientY }
    updateDrag(e.clientX, e.clientY)
  }

  /** 끄는 중인 자리를 화면 좌표로 다시 계산한다(손가락이 움직일 때와 저절로 스크롤된 뒤) */
  function updateDrag(clientX: number, clientY: number) {
    if (!drag || drag.kind === 'moveAllDay') return
    const e = { clientX, clientY }
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

  // 가장자리 자동 스크롤: 손가락으로 길게 눌러 끌면 스크롤이 막히므로, 보이는 시간 밖으로 옮기려면 그리드가 따라 움직여야 한다
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const updateRef = useRef(updateDrag)
  useLayoutEffect(() => {
    updateRef.current = updateDrag
  })
  const gridDragging = !!drag && drag.kind !== 'moveAllDay'
  useEffect(() => {
    if (!gridDragging) {
      pointer.current = null
      return
    }
    let frame = 0
    const tick = () => {
      const el = scrollRef.current
      const p = pointer.current
      if (el && p) {
        // 가장자리는 창에 보이는 부분으로 자른다: 배너 등으로 그리드 끝이 창 밖이면 창 끝이 가장자리다(CAL-94)
        const rect = el.getBoundingClientRect()
        const top = Math.max(rect.top, 0)
        const bottom = Math.min(rect.bottom, window.innerHeight)
        const into =
          p.y < top + EDGE_ZONE ? p.y - (top + EDGE_ZONE) : p.y > bottom - EDGE_ZONE ? p.y - (bottom - EDGE_ZONE) : 0
        const speed = Math.max(-1, Math.min(1, into / EDGE_ZONE)) * EDGE_MAX_SPEED
        const before = el.scrollTop
        if (speed) el.scrollTop = before + speed
        if (el.scrollTop !== before) updateRef.current(p.x, p.y)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [gridDragging])

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (gridHold.end(e)) return
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
    if (!barEl) {
      // 손가락은 떼었을 때 만든다(밀어서 스크롤하려던 것이면 만들지 않음)
      const create = () => props.onCreateAllDay(days[dayIndex])
      if (!allDayHold.start(e, () => {}, create)) create()
      return
    }
    const bar = bars.find((b) => occurrenceKey(b.occurrence) === barEl.dataset.bar)
    if (!bar) return
    const next: Drag = {
      kind: 'moveAllDay',
      occurrence: bar.occurrence,
      anchorDay: dayIndex,
      deltaDays: 0,
      x: e.clientX,
      moved: false,
    }
    const focusBar = () => barEl.focus({ preventScroll: true })
    const touch = allDayHold.start(
      e,
      () => {
        focusBar()
        setDrag(next)
      },
      () => {
        focusBar()
        props.onOpen(bar.occurrence)
      },
    )
    if (touch) return
    e.preventDefault()
    focusBar()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(next)
  }

  const onAllDayPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (allDayHold.move(e)) return
    if (drag?.kind !== 'moveAllDay') return
    const moved = drag.moved || Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD
    setDrag({ ...drag, moved, deltaDays: locateAllDay(e.clientX) - drag.anchorDay })
  }

  const onAllDayPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (allDayHold.end(e)) return
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
  const { actual } = props
  // 실제 열이 있으면 계획 칸(끌기·만들기 좌표의 기준)은 왼쪽 반만 쓴다. 칸 사이 3px은 그리드 간격과 같다
  const planOnly = actual ? 'calc(50% + 1.5px)' : undefined

  return (
    <div className={styles.timeGrid}>
      <div className={styles.dayHeads} style={{ gridTemplateColumns: actual ? 'repeat(2, minmax(0, 1fr))' : columns }}>
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
                aria-label={`${dateName(date)}${holiday ? ` ${holiday}` : ''} 일 보기`}
                onClick={() => props.onOpenDay?.(date)}
                disabled={!props.onOpenDay}
              >
                <span className={styles.dayHeadName}>{label.split(' ')[0]}</span>
                <span className={styles.dayHeadNumber}>{label.split(' ')[1]}</span>
              </button>
              {holiday && <span className={styles.holidayTag}>{holiday}</span>}
              {actual && <span className={actualStyles.planLabel}>계획</span>}
            </div>
          )
        })}
        {actual && <div className={styles.dayHead}>{actual.head}</div>}
      </div>

      <div className={styles.allDayRow}>
        <span className={styles.allDayLabel}>종일</span>
        <div
          ref={allDayRef}
          className={styles.allDayCells}
          style={{
            gridTemplateColumns: columns,
            gridTemplateRows: `repeat(${allDayRows}, 24px)`,
            marginRight: planOnly,
          }}
          onPointerDown={readOnly ? undefined : onAllDayPointerDown}
          onPointerMove={readOnly ? undefined : onAllDayPointerMove}
          onPointerUp={readOnly ? undefined : onAllDayPointerUp}
          onPointerCancel={() => {
            allDayHold.cancel()
            setDrag(null)
          }}
          role="presentation"
        >
          {bars.map((bar) => {
            const shift = drag?.kind === 'moveAllDay' && drag.occurrence === bar.occurrence ? drag.deltaDays : 0
            const start = Math.max(0, bar.startIndex + shift)
            const end = Math.min(days.length, bar.startIndex + bar.span + shift)
            if (end <= start) return null
            const color = colorOf(bar.occurrence)
            if (overview)
              return (
                <div
                  key={occurrenceKey(bar.occurrence)}
                  className={styles.allDayBar}
                  data-overview
                  style={{ gridColumn: `${start + 1} / ${end + 1}`, gridRow: bar.row + 1, ...colorVars(color) }}
                  aria-hidden="true"
                >
                  {bar.occurrence.title}
                </div>
              )
            return (
              <button
                key={occurrenceKey(bar.occurrence)}
                type="button"
                data-bar={occurrenceKey(bar.occurrence)}
                data-focus-id={occurrenceFocusId(bar.occurrence)}
                data-focus-group={focusGroup(bar.occurrence, bar.occurrence.startDate!)}
                className={styles.allDayBar}
                data-dragging={shift !== 0 || undefined}
                data-held={
                  (drag?.kind === 'moveAllDay' && drag.occurrence === bar.occurrence && !drag.moved) || undefined
                }
                style={{
                  gridColumn: `${start + 1} / ${end + 1}`,
                  gridRow: bar.row + 1,
                  ...colorVars(color),
                }}
                // 마우스는 pointer 처리에서 연다. 키보드(Enter·Space)로 누른 click만 여기서 연다.
                // 오프라인이면 pointer 처리가 꺼지므로 마우스 click도 여기서 연다(SCR-SYS-02 ③ 열어 보기)
                onClick={(e) => (e.detail === 0 || readOnly) && props.onOpen(bar.occurrence)}
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
            style={{ gridTemplateColumns: columns, right: planOnly }}
            onPointerDown={readOnly ? undefined : onPointerDown}
            onPointerMove={readOnly ? undefined : onPointerMove}
            onPointerUp={readOnly ? undefined : onPointerUp}
            onPointerCancel={() => {
              gridHold.cancel()
              setDrag(null)
            }}
            onDragOver={readOnly ? undefined : onDragOver}
            onDragLeave={() => setTaskHover(null)}
            onDrop={readOnly ? undefined : onDrop}
            role="presentation"
            data-readonly={readOnly || undefined}
          >
            {days.map((date, dayIndex) => {
              const wd = weekdayIndex(date)
              const Column = overview ? 'button' : 'div'
              const count =
                segments.get(date)!.length +
                bars.filter((b) => b.startIndex <= dayIndex && dayIndex < b.startIndex + b.span).length
              return (
                <Column
                  key={date}
                  className={styles.column}
                  data-today={date === today || undefined}
                  data-rest={wd === 0 || wd === 6 || !!holidayName(date) || undefined}
                  {...(overview && {
                    type: 'button' as const,
                    'aria-label': `${dateName(date)}, 일정 ${count}개`,
                    onClick: () => props.onOpenDay?.(date),
                  })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className={styles.hourLine} style={{ top: h * HOUR_HEIGHT }} />
                  ))}
                  {capped.get(date)!.more.map((group) => (
                    <MoreButton
                      key={group.start}
                      group={group}
                      overview={overview}
                      onOpen={(opener) => setMorePopover({ group, opener })}
                    />
                  ))}
                  {capped.get(date)!.visible.map((segment) => (
                    <Block
                      key={occurrenceKey(segment.occurrence)}
                      segment={segment}
                      color={colorOf(segment.occurrence)}
                      timeZone={timeZone}
                      now={now}
                      drag={drag}
                      overview={overview}
                      readOnly={readOnly}
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
                      <span>{minutesRange(preview.start, preview.end)}</span>
                    </div>
                  )}
                  {date === nowZoned.date && (
                    <div className={styles.nowLine} style={{ top: nowZoned.minutes * PX_PER_MINUTE }}>
                      <span>{formatMinutes(nowZoned.minutes)}</span>
                    </div>
                  )}
                </Column>
              )
            })}
          </div>
          {actual?.column}
        </div>
      </div>
      {morePopover && (
        <MorePopover
          group={morePopover.group}
          opener={morePopover.opener}
          timeZone={timeZone}
          onClose={() => setMorePopover(null)}
          onOpen={(o) => {
            setMorePopover(null)
            props.onOpen(o)
          }}
        />
      )}
    </div>
  )
}

/** "+n" 이름: "14시대 일정 3개 더" */
function moreLabel(group: MoreGroup) {
  return `${Math.floor(group.start / 60)}시대 일정 ${group.hidden.length}개 더`
}

/** 상한을 넘은 겹친 일정 묶음. Tab으로 닿는 버튼이고 높이는 28px, 누르는 영역은 ::after로 44px(목업 묶음0_B G1) */
function MoreButton({
  group,
  overview,
  onOpen,
}: {
  group: MoreGroup
  overview: boolean
  onOpen: (opener: HTMLElement) => void
}) {
  // 오른쪽 "+n" 자리(MORE_PX - 4). 보이는 블록이 없으면 칸 폭 전체(UX-CAL-172)
  const style: CSSProperties = group.full
    ? { top: group.start * PX_PER_MINUTE + 1, left: 2, right: 2 }
    : { top: group.start * PX_PER_MINUTE + 1, right: 2, width: MORE_PX - 4 }
  // 훑어보기(D-77): 하루 칸 버튼 안이라 보여 주기만 한다
  if (overview)
    return (
      <div className={styles.moreBlock} style={style} aria-hidden="true">
        +{group.hidden.length}
      </div>
    )
  return (
    <button
      type="button"
      data-more
      className={styles.moreBlock}
      style={style}
      aria-haspopup="dialog"
      aria-label={moreLabel(group)}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      +{group.hidden.length}
    </button>
  )
}

/** "+n" 팝오버(G2): 열면 첫 항목에 포커스, ↑↓로 옮기고 Enter로 상세, Esc·바깥 누르기로 닫고 "+n"으로 돌아간다 */
function MorePopover({
  group,
  opener,
  timeZone,
  onClose,
  onOpen,
}: {
  group: MoreGroup
  opener: HTMLElement
  timeZone: string
  onClose: () => void
  onOpen: (o: Occurrence) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => restoreFocus(markFocus(opener))
  }, [opener])
  const rect = opener.getBoundingClientRect()
  return (
    <div className={styles.popoverLayer} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-label={moreLabel(group)}
        className={styles.dayPopover}
        style={{
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 256)),
          top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 300)),
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
            return
          }
          cycleTab(e, ref.current)
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('button'))
          const at = items.indexOf(document.activeElement as HTMLElement)
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next].focus()
        }}
      >
        <h2 className={styles.cardTitle}>{moreLabel(group)}</h2>
        {group.hidden.map((s) => (
          <button
            key={occurrenceKey(s.occurrence)}
            type="button"
            className={styles.morePopoverItem}
            onClick={() => onOpen(s.occurrence)}
          >
            <strong>
              {s.occurrence.recurring && <RepeatIcon />}
              {s.occurrence.title}
            </strong>
            <span>{timeLabel(s.occurrence, timeZone)}</span>
          </button>
        ))}
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
  overview,
  readOnly,
  onOpen,
}: {
  segment: CappedSegment
  color: BlockColor | null
  timeZone: string
  now: number
  drag: Drag | null
  overview: boolean
  /** 오프라인: pointer 처리가 꺼져 마우스 click으로 연다 */
  readOnly: boolean
  onOpen: (o: Occurrence) => void
}) {
  const o = segment.occurrence
  const end = drag?.kind === 'resize' && drag.segment === segment ? drag.end : segment.end
  const [drawnStart, drawnEnd] = drawnRange(segment.start, end)
  const top = drawnStart * PX_PER_MINUTE + 1
  // 가장 짧은 블록(30분)도 누르는 높이 24px(D-76, UX-M-CAL-91). 아래 블록과의 2px 틈만 쓰므로 겹치지 않는다
  const height = Math.max(24, (drawnEnd - drawnStart) * PX_PER_MINUTE - 2)
  const active = Date.parse(o.startAt!) <= now && now < Date.parse(o.endAt!)
  const dragging = drag?.kind === 'move' && drag.moved && drag.segment.occurrence === o
  // 길게 눌러 잡았지만 아직 움직이지 않음(손가락 끌기 시작 표시)
  const held =
    (drag?.kind === 'move' && !drag.moved && drag.segment.occurrence === o) ||
    (drag?.kind === 'resize' && drag.segment === segment)
  const content = (
    <span className={styles.blockTitle}>
      {o.recurring && <RepeatIcon />}
      {o.title}
    </span>
  )
  // 훑어보기(D-77): 하루 칸 버튼 안에서 보여 주기만 한다
  if (overview)
    return (
      <div
        className={styles.block}
        data-overview
        data-now={active || undefined}
        style={blockStyle(color, top, height, segment.column, segment.columns, segment.reserve)}
        aria-hidden="true"
      >
        {content}
      </div>
    )
  return (
    <button
      type="button"
      data-segment={`${segment.date}#${occurrenceKey(o)}`}
      data-focus-id={occurrenceFocusId(o)}
      data-focus-group={focusGroup(o, segment.date)}
      className={styles.block}
      data-now={active || undefined}
      data-dragging={dragging || undefined}
      data-held={held || undefined}
      style={blockStyle(color, top, height, segment.column, segment.columns, segment.reserve)}
      onClick={(e) => (e.detail === 0 || readOnly) && onOpen(o)}
      // 낭독 접두는 테두리와 같다: 점선은 계획, 실선(지금 진행 중)은 진행 중(X-11, CAL-93, UX-CAL-144)
      aria-label={`${active ? '진행 중' : '계획'} · ${o.title}, ${timeLabel(o, timeZone)}${o.recurring ? ', 반복' : ''}`}
    >
      {content}
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
  const [drawnStart, drawnEnd] = drawnRange(start, end)
  return (
    <div
      className={styles.ghostBlock}
      style={blockStyle(color, drawnStart * PX_PER_MINUTE + 1, (drawnEnd - drawnStart) * PX_PER_MINUTE - 2)}
      aria-hidden="true"
    >
      <strong>{seg.occurrence.title}</strong>
      <span>{minutesRange(start, end)}</span>
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

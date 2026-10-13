// 월 보기 (SCR-CAL-03): 6주 × 7일, 칸마다 일정 칩 3개 + "+n개 더보기". 칩을 끌어 다른 날짜로 옮긴다.
// 일지 상태 점(③)은 P2 데이터라 아직 없다.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { announce } from '../components/announce'
import { occurrenceKey, type Occurrence } from './api'
import { colorVars, type BlockColor } from './colors'
import { cycleTab, focusGroup, markFocus, occurrenceFocusId, restoreFocus } from './focus'
import { holidayName } from './holidays'
import { occurrencesByDate } from './layout'
import { BLOCK_STATE_LABEL, type BlockState } from './recordStatus'
import { RepeatIcon, StateText } from './TimeGrid'
import { useTouchHold } from './touchHold'
import { WEEKDAY_LABELS, dateName, diffDays, formatMinutes, timeText, toZoned, weekdayIndex } from './time'
import styles from './calendar.module.css'
import agendaStyles from './monthAgenda.module.css'

const MAX_CHIPS = 3
const MAX_DOTS = 3
const DRAG_THRESHOLD = 4

interface Props {
  days: string[]
  month: string
  occurrences: Occurrence[]
  timeZone: string
  today: string
  colorOf: (o: Occurrence) => BlockColor | null
  /** 회차의 기록 상태(2.3). 없으면 모두 계획 모양 */
  stateOf?: (o: Occurrence) => BlockState
  onOpen: (o: Occurrence) => void
  onOpenDay: (date: string) => void
  onCreateAllDay: (date: string) => void
  onMoveDays: (o: Occurrence, days: number) => void
  /** 모바일: 훑어보기 전용(D-77과 같은 방식). 칩 대신 색 점을 그리고, 날짜를 누르면 그 날을 골라 격자 아래에 일정 목록을 보인다.
   *  고른 날을 한 번 더 누르거나 [일 보기 ›]를 누르면 일 보기로 간다(UX-M-CAL-72, 모바일 규칙 ③) */
  overview?: boolean
  /** false면(오프라인, P1-X-04) 칩 끌기·빈 칸 만들기를 끈다 */
  editable?: boolean
}

type Drag = { occurrence: Occurrence; from: string; over: string; x: number; y: number; moved: boolean }

const planState = (): BlockState => 'plan'
/** 칩 낭독 접두. 계획은 지금처럼 붙이지 않는다 */
const stateLabel = (state: BlockState) => (state === 'plan' ? '' : `${BLOCK_STATE_LABEL[state]}, `)

function chipLabel(o: Occurrence, timeZone: string) {
  return o.allDay ? o.title : `${formatMinutes(toZoned(o.startAt!, timeZone).minutes)} ${o.title}`
}

export function MonthView({
  days,
  month,
  occurrences,
  timeZone,
  today,
  colorOf,
  stateOf = planState,
  overview = false,
  editable = true,
  ...props
}: Props) {
  const readOnly = overview || !editable
  const byDate = useMemo(() => occurrencesByDate(occurrences, days, timeZone), [occurrences, days, timeZone])
  const [drag, setDrag] = useState<Drag | null>(null)
  const cellsRef = useRef<HTMLDivElement>(null)
  // 손가락은 길게 누른 뒤에만 칩을 옮긴다(바로 밀면 스크롤)
  const hold = useTouchHold(cellsRef)
  const [popover, setPopover] = useState<{ date: string; x: number; y: number; opener: HTMLElement } | null>(null)
  // 모바일 아래 목록의 날. 처음은 오늘, 오늘이 이 달이 아니면 1일. 달을 옮기면 다시 정한다
  const firstPick = today.startsWith(month) ? today : `${month}-01`
  const [picked, setPicked] = useState({ month, date: firstPick })
  const selected = picked.month === month ? picked.date : firstPick

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
    const next: Drag = { occurrence, from: date, over: date, x: e.clientX, y: e.clientY, moved: false }
    const focusChip = () => chip.focus({ preventScroll: true })
    const touch = hold.start(
      e,
      () => {
        focusChip()
        setDrag(next)
      },
      () => {
        focusChip()
        props.onOpen(occurrence)
      },
    )
    if (touch) return
    // 끌기를 위해 기본 동작을 막으면 칩이 포커스를 받지 못한다. 직접 옮겨 두어야 연 창을 닫을 때 이 칩으로 돌아온다
    e.preventDefault()
    focusChip()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(next)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (hold.move(e)) return
    if (!drag) return
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_THRESHOLD
    setDrag({ ...drag, moved, over: dateAt(e.clientX, e.clientY) ?? drag.over })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (hold.end(e)) return
    if (!drag) return
    setDrag(null)
    if (!drag.moved) return props.onOpen(drag.occurrence)
    const shift = diffDays(drag.from, drag.over)
    if (shift) props.onMoveDays(drag.occurrence, shift)
  }

  const heads = days.slice(0, 7).map((d) => weekdayIndex(d))

  return (
    <div className={styles.monthWrap}>
      <div>
        <div className={styles.monthHeads} aria-hidden="true">
          {heads.map((wd) => (
            <span key={wd} style={wd === 0 ? { color: 'var(--color-danger)' } : undefined}>
              {WEEKDAY_LABELS[wd]}
            </span>
          ))}
        </div>
        <div
          ref={cellsRef}
          className={styles.monthCells}
          onPointerDown={readOnly ? undefined : onPointerDown}
          onPointerMove={readOnly ? undefined : onPointerMove}
          onPointerUp={readOnly ? undefined : onPointerUp}
          onPointerCancel={() => {
            hold.cancel()
            setDrag(null)
          }}
          role="presentation"
        >
          {days.map((date) => {
            const list = byDate.get(date)!
            const holiday = holidayName(date)
            const wd = weekdayIndex(date)
            const shown = list.slice(0, list.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS)
            if (overview)
              return (
                <button
                  key={date}
                  type="button"
                  className={`${styles.monthCell} ${date === selected ? agendaStyles.picked : ''}`}
                  data-overview
                  data-out={!date.startsWith(month) || undefined}
                  data-today={date === today || undefined}
                  data-holiday={!!holiday || undefined}
                  data-rest={wd === 0 || wd === 6 || !!holiday || undefined}
                  aria-pressed={date === selected}
                  aria-label={`${dateName(date)}${holiday ? ` ${holiday}` : ''}, 일정 ${list.length}개`}
                  onClick={() => {
                    if (date === selected) return props.onOpenDay(date)
                    setPicked({ month, date })
                    // 아래 목록이 바뀐 것을 알린다(UX-M-CAL-92). 고를 때만 한 번: 달 이동·데이터 도착으로는 읽지 않는다
                    announce(`${dateName(date)} 일정 ${list.length}개`)
                  }}
                >
                  <span className={styles.dateNumber}>{Number(date.slice(8))}</span>
                  <span className={styles.monthDots} aria-hidden="true">
                    {list.slice(0, MAX_DOTS).map((o) => (
                      <span key={occurrenceKey(o)} className={styles.monthDot} style={colorVars(colorOf(o))} />
                    ))}
                    {list.length > MAX_DOTS && <span>+{list.length - MAX_DOTS}</span>}
                  </span>
                </button>
              )
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
                onClick={(e) => editable && e.target === e.currentTarget && props.onCreateAllDay(date)}
              >
                <div className={styles.monthCellHead}>
                  <button
                    type="button"
                    className={styles.dateNumber}
                    aria-label={`${dateName(date)}${holiday ? ` ${holiday}` : ''} 일 보기`}
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
                    data-focus-group={focusGroup(o, date)}
                    className={styles.chip}
                    data-state={stateOf(o)}
                    data-held={(drag?.occurrence === o && drag.from === date && !drag.moved) || undefined}
                    style={colorVars(colorOf(o))}
                    // 오프라인이면 pointer 처리가 꺼지므로 마우스 click도 여기서 연다(SCR-SYS-02 ③ 열어 보기)
                    onClick={(e) => (e.detail === 0 || readOnly) && props.onOpen(o)}
                    // 칸이 좁으면 시각을 숨기므로(제목 우선, SCR-CAL-03) 접근 이름에는 시각을 그대로 둔다
                    aria-label={`${stateLabel(stateOf(o))}${chipLabel(o, timeZone)}${o.recurring ? ', 반복' : ''}`}
                  >
                    <StateText state={stateOf(o)} />
                    {o.recurring && <RepeatIcon />}
                    <span className={styles.chipText}>
                      {!o.allDay && (
                        <span className={styles.chipTime}>{formatMinutes(toZoned(o.startAt!, timeZone).minutes)} </span>
                      )}
                      {o.title}
                    </span>
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
                    <span className={styles.moreText}>+{list.length - shown.length}개 더보기</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {overview && (
        <DayAgenda
          date={selected}
          list={byDate.get(selected) ?? []}
          timeZone={timeZone}
          colorOf={colorOf}
          stateOf={stateOf}
          editable={editable}
          onOpen={props.onOpen}
          onOpenDay={props.onOpenDay}
          onCreate={props.onCreateAllDay}
        />
      )}
      {popover && (
        <div className={styles.popoverLayer} onPointerDown={(e) => e.target === e.currentTarget && setPopover(null)}>
          <div
            role="dialog"
            data-day-popover
            onKeyDown={(e) => cycleTab(e, e.currentTarget)}
            aria-label={`${dateName(popover.date)} 일정`}
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
                data-state={stateOf(o)}
                style={colorVars(colorOf(o))}
                onClick={() => {
                  setPopover(null)
                  props.onOpen(o)
                }}
              >
                <StateText state={stateOf(o)} />
                {o.recurring && <RepeatIcon />}
                <span className={styles.chipText}>{chipLabel(o, timeZone)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 모바일 월 보기 아래: 고른 날의 일정(시각 · 제목 한 줄, 44px 행) */
function DayAgenda({
  date,
  list,
  timeZone,
  colorOf,
  stateOf,
  editable,
  onOpen,
  onOpenDay,
  onCreate,
}: {
  date: string
  list: Occurrence[]
  timeZone: string
  colorOf: (o: Occurrence) => BlockColor | null
  stateOf: (o: Occurrence) => BlockState
  editable: boolean
  onOpen: (o: Occurrence) => void
  onOpenDay: (date: string) => void
  onCreate: (date: string) => void
}) {
  const heading = `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${WEEKDAY_LABELS[weekdayIndex(date)]})`
  return (
    <section className={agendaStyles.agenda} aria-label={`${dateName(date)} 일정`}>
      <div className={agendaStyles.agendaHead}>
        <h2 className={agendaStyles.agendaTitle}>
          {heading} · 일정 {list.length}
        </h2>
        <button
          type="button"
          className={agendaStyles.agendaDay}
          aria-label={`${dateName(date)} 일 보기`}
          onClick={() => onOpenDay(date)}
        >
          일 보기 ›
        </button>
      </div>
      {list.length === 0 ? (
        <div className={agendaStyles.agendaEmpty}>
          <span>일정이 없어요</span>
          <button
            type="button"
            className={agendaStyles.agendaCreate}
            disabled={!editable}
            onClick={() => onCreate(date)}
          >
            + 일정
          </button>
        </div>
      ) : (
        <ul className={agendaStyles.agendaList}>
          {list.map((o) => (
            <li key={occurrenceKey(o)}>
              <button
                type="button"
                className={agendaStyles.agendaItem}
                data-state={stateOf(o)}
                style={colorVars(colorOf(o))}
                data-focus-id={occurrenceFocusId(o)}
                data-focus-group={focusGroup(o, date)}
                onClick={() => onOpen(o)}
              >
                <span className={`${styles.listColor} ${agendaStyles.agendaDot}`} />
                <span className={agendaStyles.agendaTime}>{timeText(o, date, timeZone)}</span>{' '}
                {/* 진행 중은 홈 오늘 일정 행처럼 행을 채우고 흰 면 배지로 보인다. 낭독은 다른 상태(StateText)와 같은 "상태, " 꼴 */}
                {stateOf(o) === 'now' && (
                  <>
                    <span className={agendaStyles.nowTag} aria-hidden="true">
                      {BLOCK_STATE_LABEL.now}
                    </span>
                    <span className="visually-hidden">{BLOCK_STATE_LABEL.now}, </span>
                  </>
                )}
                <StateText state={stateOf(o)} />
                <span className={agendaStyles.agendaText}>{o.title}</span>
                {o.recurring && (
                  <>
                    <RepeatIcon />
                    <span className="visually-hidden">, 반복</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

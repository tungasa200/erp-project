// SCR-HOME-01 ③ 오늘 일정 (P2-08, SCH-05). 시간 기록 옵션(TIME-09)에 따라 두 모양:
// - 꺼짐: 계획 목록 + 완료 체크. 끝난 회차는 기록 상태(했어요·안 했어요·확인 대기, 화면정의서 2.3), 확인 대기는 그 자리에서 했어요/안 했어요.
// - 켜짐: 계획/실제 두 열 시간 격자. 실제 = 시작 시각이 있는 확정 기록. 확인 대기 블록을 누르면 SCR-HOME-02 패널.
// 둘 다 현재 시각을 표시한다. 켜짐이면 실제 열에 빈 구간(SCR-HOME-03, P2-07)을 버튼으로 두고, 열 머리에 오늘 합계를 적는다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import type { Occurrence } from '../calendar/api'
import { formatMinutes, toZoned } from '../calendar/time'
import { focusSectionHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useProjects } from '../projects/api'
import { projectColor } from '../projects/palette'
import { usePendingDecision, type Decision } from '../records/usePendingDecision'
import type { WorkRecord } from '../records/api'
import { RecordDialog } from '../records/RecordDialog'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { GapFill } from './GapFill'
import { durationText, useTimeGaps, useTimeSummary, type TimeGap } from './gaps'
import homeStyles from './home.module.css'
import { actualEntries, gridRange, packLanes, planEntries, useRecordsOn, type PlanEntry } from './timeline'
import styles from './TodayTimeline.module.css'

interface Props {
  occurrences: Occurrence[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  today: string
  timeZone: string
  now: number
  /** 확인 대기 패널(SCR-HOME-02)을 연다 — 격자 모양의 확인 대기 블록 */
  onOpenPending: (e: { currentTarget: HTMLElement }) => void
}

// 30분 블록 = 28px(테두리 안 누르는 영역 24px 이상, D-76)
const NO_GAPS: TimeGap[] = []
const HOUR_PX = 56
const MIN_BLOCK = 30
// '지금' 알약은 시간 열에 그린다. 그 근처 시각 라벨은 겹치므로 숨긴다
const NOW_LABEL_CLEAR = 20

export function TodayTimeline(props: Props) {
  const { occurrences, loading, failed, onRetry, today, timeZone, now } = props
  const timeTracking = useTimeTracking()
  const records = useRecordsOn(today)
  const items = records.data ?? []
  const entries = planEntries(occurrences, items, today, timeZone, now)
  const nowMinutes = toZoned(now, timeZone).minutes

  // 회차가 끝나면 서버가 확인 대기를 만든다. 보고 있는 동안 끝난 것도 버튼이 생기게 다시 받는다
  const ended = entries.filter((e) => e.phase === 'ended').length
  const seenEnded = useRef(ended)
  const queryClient = useQueryClient()
  useEffect(() => {
    if (ended > seenEnded.current) void queryClient.invalidateQueries({ queryKey: ['records'] })
    seenEnded.current = ended
  }, [ended, queryClient])

  const headingRef = useRef<HTMLHeadingElement>(null)
  const empty = !loading && !failed && occurrences.length === 0
  const actual = actualEntries(items, today, timeZone, now)
  const gapsQuery = useTimeGaps(today, timeTracking)
  const gaps = gapsQuery.data ?? NO_GAPS
  const showGrid =
    timeTracking && !loading && !failed && (occurrences.length > 0 || actual.timed.length > 0 || gaps.length > 0)

  return (
    <section aria-labelledby="home-today" className={`${homeStyles.panel} ${styles.panel}`}>
      <div className={homeStyles.panelHead}>
        <h2 id="home-today" ref={headingRef} tabIndex={-1} className={homeStyles.panelTitle}>
          오늘 일정
        </h2>
        <Link to={`/calendar/day/${today}`} className={styles.dayLink}>
          일 보기
        </Link>
      </div>
      {loading && <Skeleton count={3} />}
      {failed && (
        <p role="alert" className={homeStyles.error}>
          일정을 불러오지 못했어요
          <button
            type="button"
            className={homeStyles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              onRetry()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {records.isError && !loading && !failed && (
        <p role="alert" className={homeStyles.error}>
          기록 상태를 불러오지 못했어요
          <button
            type="button"
            className={homeStyles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              void records.refetch()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {/* 켜짐이면 빈 시간이 격자를 띄울 수 있어 받을 때까지 '없어요'를 미룬다 */}
      {empty && !showGrid && !(timeTracking && gapsQuery.isPending) && (
        <p className={homeStyles.muted}>오늘 잡힌 일정이 없어요</p>
      )}
      {showGrid ? (
        <PlanActualGrid
          entries={entries}
          actual={actual}
          gaps={gaps}
          nowMinutes={nowMinutes}
          today={today}
          timeZone={timeZone}
          headingRef={headingRef}
          onOpenPending={props.onOpenPending}
        />
      ) : (
        !loading &&
        !failed &&
        entries.length > 0 && (
          <PlanList entries={entries} nowMinutes={nowMinutes} statusKnown={records.isSuccess} headingRef={headingRef} />
        )
      )}
    </section>
  )
}

/** 옵션 꺼짐: 계획 + 완료 체크 */
function PlanList(props: {
  entries: PlanEntry[]
  nowMinutes: number
  statusKnown: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const { entries, nowMinutes, statusKnown, headingRef } = props
  const { decide } = usePendingDecision()
  const online = useOnline()
  const [busy, setBusy] = useState<string | null>(null)
  const colorOf = useColorOf()

  // 처리한 행의 버튼이 사라지면 다음 확인 대기의 했어요로, 없으면 제목으로
  const focusNext = useRef<{ after: string; next: string | null } | null>(null)
  useEffect(() => {
    const want = focusNext.current
    if (!want) return
    const done = entries.find((e) => e.key === want.after)
    if (done?.record?.status === 'PENDING') return
    focusNext.current = null
    const next = want.next && document.querySelector<HTMLElement>(`[data-timeline-confirm="${CSS.escape(want.next)}"]`)
    ;(next || headingRef.current)?.focus()
  }, [entries, headingRef])

  const pendingKeys = entries.filter((e) => e.record?.status === 'PENDING').map((e) => e.key)
  const onDecide = async (entry: PlanEntry, status: Decision) => {
    if (!entry.record || busy) return
    setBusy(entry.key)
    const i = pendingKeys.indexOf(entry.key)
    const next = pendingKeys[i + 1] ?? pendingKeys[i - 1] ?? null
    await decide(entry.record, status, () => {
      focusNext.current = { after: entry.key, next }
    })
    setBusy(null)
  }

  // 수정(SCR-REC-01): 저장하면 했어요가 되어 버튼이 사라지므로 했어요와 같게 포커스를 예약한다
  const [editing, setEditing] = useState<PlanEntry | null>(null)
  const closeEditor = (changed: boolean) => {
    const entry = editing
    setEditing(null)
    if (!changed || !entry) return
    const i = pendingKeys.indexOf(entry.key)
    focusNext.current = { after: entry.key, next: pendingKeys[i + 1] ?? pendingKeys[i - 1] ?? null }
  }

  // 현재 시각 줄: 시간 일정 중 지금 이후에 시작하는 첫 항목 앞(종일 일정 뒤)
  const timed = entries.filter((e) => !e.occurrence.allDay)
  const nowIndex = timed.length ? entries.findIndex((e) => !e.occurrence.allDay && e.start > nowMinutes) : -1
  const nowAt = nowIndex === -1 && timed.length ? entries.length : nowIndex

  return (
    <>
      {editing?.record && (
        <RecordDialog
          recordId={editing.record.id}
          planned={
            editing.occurrence.allDay
              ? undefined
              : { startAt: editing.occurrence.startAt!, endAt: editing.occurrence.endAt! }
          }
          onClose={closeEditor}
        />
      )}
      <ol className={styles.list}>
        {entries.map((entry, index) => (
          <PlanRowWithNow key={entry.key} showNow={index === nowAt} nowMinutes={nowMinutes}>
            <PlanRow
              entry={entry}
              color={colorOf(entry.occurrence.projectId)}
              statusKnown={statusKnown}
              disabled={!online || busy === entry.key}
              offline={!online}
              onDecide={(status) => void onDecide(entry, status)}
              onEdit={() => setEditing(entry)}
            />
          </PlanRowWithNow>
        ))}
        {nowAt === entries.length && <NowLine minutes={nowMinutes} />}
      </ol>
      {/* 버튼 title은 터치에서 안 보이므로 끊겼을 때는 글로 알린다 */}
      {!online && pendingKeys.length > 0 && <p className={homeStyles.muted}>연결되면 처리할 수 있어요</p>}
    </>
  )
}

function PlanRowWithNow(props: { showNow: boolean; nowMinutes: number; children: ReactNode }) {
  return (
    <>
      {props.showNow && <NowLine minutes={props.nowMinutes} />}
      {props.children}
    </>
  )
}

function NowLine({ minutes }: { minutes: number }) {
  return (
    <li className={styles.nowLine}>
      <span className={styles.nowLabel}>지금 {formatMinutes(minutes)}</span>
    </li>
  )
}

function PlanRow(props: {
  entry: PlanEntry
  color: ReturnType<typeof projectColor> | null
  statusKnown: boolean
  disabled: boolean
  offline: boolean
  onDecide: (status: Decision) => void
  onEdit: () => void
}) {
  const { entry, color, statusKnown, disabled, offline, onDecide, onEdit } = props
  const { occurrence: o, record, phase } = entry
  const status = record?.status
  const rowClass = [
    styles.row,
    status === 'PENDING' && styles.rowPending,
    status === 'DISMISSED' && styles.rowSkipped,
    status === 'CONFIRMED' && styles.rowDone,
    phase === 'now' && styles.rowNow,
  ]
    .filter(Boolean)
    .join(' ')
  const style = color ? ({ '--plan-base': color.base, '--plan-tint': color.tint } as CSSProperties) : undefined

  return (
    <li className={rowClass} style={style}>
      <span className={styles.time}>{o.allDay ? '종일' : `${formatMinutes(entry.start)} – ${endText(entry.end)}`}</span>
      <span className={styles.title} title={o.title}>
        {o.title}
      </span>
      <span className={styles.state}>
        {phase === 'now' && <span className={styles.tagNow}>진행 중</span>}
        {status === 'CONFIRMED' && (
          <span className={styles.tagDone}>
            <span aria-hidden="true">✓ </span>했어요
          </span>
        )}
        {status === 'DISMISSED' && <span className={styles.tagSkipped}>안 했어요</span>}
        {/* 기록이 아직 없으면(끝난 직후·목록을 못 받음) '확인 대기'라고 단정하지 않는다 */}
        {phase === 'ended' && !record && statusKnown && <span className={styles.tagMuted}>끝남</span>}
        {status === 'PENDING' && (
          <span className={styles.actions}>
            <span className={styles.tagPending}>확인 대기</span>
            <button
              type="button"
              className={styles.yes}
              data-timeline-confirm={entry.key}
              aria-label={`${o.title} 했어요`}
              disabled={disabled}
              title={offline ? '연결되면 처리할 수 있어요' : undefined}
              onClick={() => onDecide('CONFIRMED')}
            >
              했어요
            </button>
            <button
              type="button"
              className={styles.no}
              aria-label={`${o.title} 수정`}
              aria-haspopup="dialog"
              disabled={disabled}
              title={offline ? '연결되면 처리할 수 있어요' : undefined}
              onClick={onEdit}
            >
              수정
            </button>
            <button
              type="button"
              className={styles.no}
              aria-label={`${o.title} 안 했어요`}
              disabled={disabled}
              title={offline ? '연결되면 처리할 수 있어요' : undefined}
              onClick={() => onDecide('DISMISSED')}
            >
              안 했어요
            </button>
          </span>
        )}
      </span>
    </li>
  )
}

/** 옵션 켜짐: 계획/실제 두 열 */
function PlanActualGrid(props: {
  entries: PlanEntry[]
  actual: ReturnType<typeof actualEntries>
  gaps: TimeGap[]
  nowMinutes: number
  today: string
  timeZone: string
  headingRef: RefObject<HTMLHeadingElement | null>
  onOpenPending: Props['onOpenPending']
}) {
  const { entries, actual, gaps, nowMinutes, today, timeZone, headingRef, onOpenPending } = props
  const colorOf = useColorOf()
  const online = useOnline()
  const total = useTimeSummary(today, today).data?.totalMin
  const totalText = total ? `오늘 ${durationText(total)}` : null
  const [filling, setFilling] = useState<TimeGap | null>(null)
  // 채우면 누른 빈 구간이 사라지므로 제목으로. 모달이 닫히며(정리 단계) 돌려준 포커스를 같은 커밋의 이 효과가 덮는다
  const refocus = useRef(false)
  useEffect(() => {
    if (filling || !refocus.current) return
    refocus.current = false
    headingRef.current?.focus()
  }, [filling, headingRef])
  const gapSpans = gaps.map((g) => ({ gap: g, start: toZoned(g.startAt, timeZone).minutes, end: gapEnd(g, timeZone) }))
  const allDay = entries.filter((e) => e.occurrence.allDay)
  const timedPlan = entries.filter((e) => !e.occurrence.allDay)
  const [from, to] = gridRange([...timedPlan, ...actual.timed, ...gapSpans], nowMinutes)
  const px = (m: number) => ((m - from) / 60) * HOUR_PX
  const place = (start: number, end: number, lane: number, lanes: number): CSSProperties => ({
    top: px(start),
    height: Math.max(px(end) - px(start), (MIN_BLOCK / 60) * HOUR_PX) - 2,
    left: `calc(${(lane / lanes) * 100}% + 2px)`,
    width: `calc(${100 / lanes}% - 4px)`,
  })
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60)
  const showNow = nowMinutes >= from && nowMinutes <= to
  const untimedMinutes = actual.untimed.reduce((sum, r) => sum + (r.durationMin ?? 0), 0)

  return (
    <div className={styles.grid}>
      {allDay.length > 0 && (
        <p className={styles.allDay}>
          <span className={styles.allDayLabel}>종일</span>
          {allDay.map((e) => e.occurrence.title).join(', ')}
        </p>
      )}
      <div className={styles.gridHead} aria-hidden="true">
        <span />
        <span>계획</span>
        <span>실제{totalText && <span className={styles.total}> · {totalText}</span>}</span>
      </div>
      <div className={styles.gridBody} style={{ height: px(to) }}>
        <div className={styles.hours} aria-hidden="true">
          {hours.map((h) => (
            <span
              key={h}
              className={styles.hour}
              style={{
                top: px(h),
                visibility: showNow && Math.abs(h - nowMinutes) < NOW_LABEL_CLEAR ? 'hidden' : undefined,
              }}
            >
              {formatMinutes(h)}
            </span>
          ))}
        </div>
        <ul className={styles.track} aria-label="계획">
          {packLanes(timedPlan, MIN_BLOCK).map(({ item: e, lane, lanes }) => {
            const color = colorOf(e.occurrence.projectId)
            const status = e.record?.status
            const label = `${formatMinutes(e.start)}–${endText(e.end)} ${e.occurrence.title}${statusText(status)}`
            const className = [
              styles.block,
              status === 'PENDING' && styles.rowPending,
              status === 'DISMISSED' && styles.rowSkipped,
              status === 'CONFIRMED' && styles.rowDone,
            ]
              .filter(Boolean)
              .join(' ')
            const style = {
              ...place(e.start, e.end, lane, lanes),
              ...(color ? { '--plan-base': color.base, '--plan-tint': color.tint } : {}),
            } as CSSProperties
            return (
              <li key={e.key} className={className} style={style}>
                {status === 'PENDING' ? (
                  <button
                    type="button"
                    className={styles.blockButton}
                    aria-haspopup="dialog"
                    aria-label={`${label}, 눌러서 확인`}
                    title={label}
                    onClick={onOpenPending}
                  >
                    <BlockText title={e.occurrence.title} tag="확인 대기" />
                  </button>
                ) : (
                  <span aria-label={label} title={label} role="img" className={styles.blockInner}>
                    <BlockText
                      title={e.occurrence.title}
                      tag={status === 'CONFIRMED' ? '✓' : status === 'DISMISSED' ? '안 함' : undefined}
                    />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <ul className={styles.track} aria-label={totalText ? `실제, ${totalText}` : '실제'}>
          {/* 빈 구간을 먼저 그려 겹치면 기록 블록이 위에 온다 */}
          {gapSpans.map(({ gap, start, end }) => {
            const label = `빈 시간 ${formatMinutes(start)}–${endText(end)}, ${durationText(gap.minutes)}, 눌러서 채우기`
            return (
              <li key={gap.startAt} className={`${styles.block} ${styles.gap}`} style={place(start, end, 0, 1)}>
                <button
                  type="button"
                  className={styles.blockButton}
                  aria-haspopup="dialog"
                  aria-label={label}
                  title={label}
                  onClick={() => setFilling(gap)}
                >
                  <BlockText title="빈 시간" tag={durationText(gap.minutes)} />
                </button>
              </li>
            )
          })}
          {packLanes(actual.timed, MIN_BLOCK).map(({ item: a, lane, lanes }) => {
            const color = a.record.projectId ? colorOf(a.record.projectId) : null
            const style = {
              ...place(a.start, a.end, lane, lanes),
              ...(color ? { '--plan-base': color.base, '--plan-tint': color.tint } : {}),
            } as CSSProperties
            const label = `${formatMinutes(a.start)}–${a.running ? '지금' : endText(a.end)} ${a.record.content}${a.running ? ', 진행 중' : ''}`
            return (
              <li key={a.record.id} className={`${styles.block} ${styles.actual}`} style={style}>
                <span aria-label={label} title={label} role="img" className={styles.blockInner}>
                  <BlockText title={a.record.content} tag={a.running ? '진행 중' : undefined} />
                </span>
              </li>
            )
          })}
        </ul>
        {actual.timed.length === 0 && gapSpans.length === 0 && (
          <p className={styles.noActual}>아직 시간을 남긴 기록이 없어요</p>
        )}
        {showNow && (
          <div className={styles.gridNow} style={{ top: px(nowMinutes) }}>
            <span className={styles.nowLabel}>지금 {formatMinutes(nowMinutes)}</span>
          </div>
        )}
      </div>
      {/* 확인 대기 블록은 패널을 열 뿐이지만, 열어도 처리할 수 없다는 것을 미리 글로 알린다(목록 모양과 같게) */}
      {!online && timedPlan.some((e) => e.record?.status === 'PENDING') && (
        <p className={homeStyles.muted}>연결되면 처리할 수 있어요</p>
      )}
      {filling && (
        <GapFill
          gap={filling}
          timeZone={timeZone}
          onClose={(filled) => {
            refocus.current = filled
            setFilling(null)
          }}
        />
      )}
      {actual.untimed.length > 0 && (
        <p className={homeStyles.muted}>
          {`시간 없이 남긴 기록 ${actual.untimed.length}건${untimedMinutes > 0 ? ` · ${durationText(untimedMinutes)}` : ''}`}
        </p>
      )}
    </div>
  )
}

function BlockText({ title, tag }: { title: string; tag?: string }) {
  return (
    <>
      <span className={styles.blockTitle}>{title}</span>
      {tag && <span className={styles.blockTag}>{tag}</span>}
    </>
  )
}

function useColorOf() {
  const projects = useProjects()
  return (projectId: string | null | undefined) => {
    const p = projectId ? projects.data?.find((x) => x.id === projectId) : undefined
    return p ? projectColor(p.color) : null
  }
}

const endText = (m: number) => (m >= 24 * 60 ? '24:00' : formatMinutes(m))

function statusText(status: WorkRecord['status'] | undefined) {
  if (status === 'CONFIRMED') return ', 했어요'
  if (status === 'DISMISSED') return ', 안 했어요'
  if (status === 'PENDING') return ', 확인 대기'
  return ''
}

/** 빈 구간 끝(분). 자정에 끝나면 24:00 */
function gapEnd(gap: TimeGap, timeZone: string) {
  const end = toZoned(gap.endAt, timeZone)
  const start = toZoned(gap.startAt, timeZone)
  return end.date !== start.date ? 24 * 60 : end.minutes
}

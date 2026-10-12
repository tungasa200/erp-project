// SCR-HOME-01 홈 대시보드 (P1-11): ② 요약 카드 · ④ 남은 업무 · ⑥ 다가오는 일정.
// 확인 대기(P2-03): 요약 카드와 2건 이상일 때 띠, 누르면 SCR-HOME-02 패널. ③ 오늘 일정(P2-08)은 TodayTimeline.
// ⑤ 오늘 마감·⑦ 이번 주 마감(P3-04, 업무일지 숨김 2026-10-12로 이름만 바뀜)은 오른쪽 열에 ⑥ 다가오는 일정과 함께 쌓는다(⑤ ⑥ ⑦ 순).
// 다가오는 일정은 내일부터 7일 뒤까지 보여 준다(UX-HOME-10, 오늘은 ③에서만).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useOnline } from '../components/useOnline'
import { occurrenceKey, useOccurrences, type Occurrence } from '../calendar/api'
import { holidayName } from '../calendar/holidays'
import { occurrencesByDate } from '../calendar/layout'
import { fromZoned } from '../calendar/time'
import { formatMinutes, toZoned } from '../format/datetime'
import { focusSectionHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { useProjects, type Project } from '../projects/api'
import { projectColor } from '../projects/palette'
import { PendingPanel } from '../records/PendingPanel'
import { usePendingRecords } from '../records/pending'
import { addDays, isoWeekday, shortDate, todayIn, WEEKDAY_NAMES, weekStartNumber } from '../quickInput/dates'
import { TodayLogCard, WeekLogStatus } from '../logs/HomeLogCards'
import { useTasks, type Task } from '../tasks/api'
import { isCompletionResultFocused } from '../tasks/completionResultContext'
import { useCompleteTask } from '../tasks/useCompleteTask'
import { DEFAULT_STATUSES, dueLabel, dueState, groupTasks } from '../tasks/view'
import { useNow } from './useNow'
import styles from './home.module.css'
import { TodayTimeline } from './TodayTimeline'
import { CloseBand } from './CloseBand'
import { useCloseBand } from './closeBandState'

const UPCOMING_DAYS = 7
const UPCOMING_LIMIT = 8

export function HomeDashboard({ empty }: { empty: ReactNode }) {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const weekStart = weekStartNumber(user?.weekStart)
  const now = useNow()
  const today = todayIn(timeZone, new Date(now))
  const weekFirst = addDays(today, -((isoWeekday(today) - weekStart + 7) % 7))

  const projects = useProjects()
  const remaining = useTasks({ status: DEFAULT_STATUSES, sort: 'due', limit: 100 })
  const doneThisWeek = useTasks({
    status: ['DONE'],
    completedSince: fromZoned(weekFirst, 0, timeZone),
    sort: 'created',
    limit: 100,
  })
  const occurrences = useOccurrences(
    fromZoned(today, 0, timeZone),
    fromZoned(addDays(today, UPCOMING_DAYS + 1), 0, timeZone),
  )

  const days = Array.from({ length: UPCOMING_DAYS + 1 }, (_, i) => addDays(today, i))
  const byDate = occurrencesByDate(occurrences.data ?? [], days, timeZone)
  const todayList = byDate.get(today) ?? []
  const notEnded = (o: Occurrence) => o.allDay || Date.parse(o.endAt!) > now
  const todayLeft = todayList.filter(notEnded).length

  const overdue = remaining.items.filter((t) => dueState(t.dueDate, today, weekStart) === 'overdue').length
  const more = (q: { hasNextPage: boolean }) => (q.hasNextPage ? '+' : '')
  const noTasks = !remaining.isPending && !remaining.isError && remaining.items.length === 0

  const pending = usePendingRecords()
  const pendingCount = pending.data?.length ?? 0
  const [pendingOpen, setPendingOpen] = useState(false)
  // 닫으면 연 버튼으로 포커스를 돌려준다. 타임라인 블록은 처리하다 사라질 수 있어 그때는 요약 줄의 확인 대기로
  const opener = useRef<HTMLElement | null>(null)
  const pendingCard = useRef<HTMLButtonElement>(null)
  // 0건이어도 같은 길로 열어 빈 목록을 보인다(UX-HOME-02: 같아 보이는 항목 하나만 안 눌리면 고장처럼 보인다)
  const openPending = (e: { currentTarget: HTMLElement }) => {
    opener.current = e.currentTarget
    setPendingOpen(true)
  }
  const closePending = useCallback((emptied: boolean) => {
    setPendingOpen(false)
    // 패널이 사라지기 전에 옮긴다(늦으면 BODY로 빠져 포커스 안전망이 화면 제목으로 보낸다).
    // 다 처리해 닫히면 연 블록도 곧 사라지므로 요약 줄의 확인 대기로
    const back = !emptied && opener.current?.isConnected ? opener.current : pendingCard.current
    back?.focus()
  }, [])

  const band = useCloseBand(today, now, timeZone)

  return (
    <>
      <CloseBand state={band} today={today} timeZone={timeZone} pendingCount={pendingCount} />
      {/* ② 요약 한 줄(UX-HOME-02, X-02): 큰 숫자 타일 대신 줄 하나. 항목마다 목록으로 가는 링크, 상태는 숫자 색으로만 */}
      <ul className={styles.summary} aria-label="요약">
        <SummaryItem
          to="/tasks"
          label="남은 업무"
          value={cardValue(remaining, `${remaining.items.length}${more(remaining)}`)}
        >
          {!remaining.isPending && !remaining.isError && overdue > 0 && (
            <span className={styles.summaryOver}>초과 {overdue}</span>
          )}
        </SummaryItem>
        <SummaryItem
          to={`/calendar/day/${today}`}
          label="오늘 일정"
          value={cardValue(occurrences, String(todayList.length))}
        >
          {occurrences.isSuccess && todayList.length > 0 && (
            <span className={styles.summarySub}>{todayLeft === 0 ? '모두 지남' : `남은 ${todayLeft}`}</span>
          )}
        </SummaryItem>
        <li>
          <button
            ref={pendingCard}
            type="button"
            className={styles.summaryItem}
            aria-haspopup="dialog"
            onClick={openPending}
          >
            <span className={styles.summaryLabel}>확인 대기</span>
            <span
              className={pendingCount > 0 ? `${styles.summaryValue} ${styles.summaryPending}` : styles.summaryValue}
            >
              {cardValue(pending, String(pendingCount))}
            </span>
          </button>
        </li>
        {/* 이 숫자만 따로 실패하면 다른 곳에 알림이 없다. "—" 대신 말하고 다시 부를 길을 둔다(UX-HOME-150) */}
        <SummaryItem
          to="/tasks?status=DONE&completed=week"
          label="이번 주 완료"
          value={
            doneThisWeek.isError ? (
              <span className={styles.summaryFailed}>불러오지 못했어요</span>
            ) : (
              cardValue(doneThisWeek, `${doneThisWeek.items.length}${more(doneThisWeek)}`)
            )
          }
          after={
            doneThisWeek.isError && (
              <button
                type="button"
                className={styles.summaryRetry}
                aria-label="이번 주 완료 다시 불러오기"
                onClick={() => void doneThisWeek.refetch()}
              >
                다시
              </button>
            )
          }
        />
      </ul>

      {/* 노란 "확인해 주세요" 띠는 두지 않는다. 확인 대기로 가는 길은 요약 줄과 타임라인 블록(UX-HOME-140, 목업 F1·F2) */}
      {pendingOpen && <PendingPanel today={today} timeZone={timeZone} onClose={closePending} />}

      <TodayTimeline
        occurrences={todayList}
        loading={occurrences.isPending}
        failed={occurrences.isError}
        onRetry={() => void occurrences.refetch()}
        today={today}
        timeZone={timeZone}
        now={now}
        onOpenPending={openPending}
      />

      <div className={styles.columns}>
        {noTasks ? (
          <div className={styles.emptyColumn}>{empty}</div>
        ) : (
          <RemainingTasks
            tasks={remaining.items}
            loading={remaining.isPending}
            failed={remaining.isError}
            onRetry={() => void remaining.refetch()}
            today={today}
            weekStart={weekStart}
            projects={projects.data ?? []}
          />
        )}
        <div className={styles.stack}>
          {/* 마감 띠가 떠 있으면 카드의 [하루 마감]은 숨긴다(띠와 중복) */}
          <TodayLogCard today={today} timeZone={timeZone} hideClose={band === 'open'} />
          <Upcoming
            days={days}
            byDate={byDate}
            today={today}
            timeZone={timeZone}
            loading={occurrences.isPending}
            failed={occurrences.isError}
            onRetry={() => void occurrences.refetch()}
          />
          <WeekLogStatus today={today} weekFirst={weekFirst} />
        </div>
      </div>
    </>
  )
}

/** 첫 로딩은 스켈레톤(0.3초 뒤), 실패하면 0 대신 — (없는 것으로 오해하지 않게) */
function cardValue(query: { isPending: boolean; isError: boolean }, value: string): ReactNode {
  if (query.isError) return '—'
  return query.isPending ? <Skeleton shape="line" /> : value
}

function SummaryItem(props: { to: string; label: string; value: ReactNode; children?: ReactNode; after?: ReactNode }) {
  return (
    <li>
      <Link to={props.to} className={styles.summaryItem}>
        <span className={styles.summaryLabel}>{props.label}</span>
        <span className={styles.summaryValue}>{props.value}</span>
        {props.children}
      </Link>
      {props.after}
    </li>
  )
}

interface RemainingProps {
  tasks: Task[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  today: string
  weekStart: number
  projects: Project[]
}

const HOME_TASK_LIMIT = 10

function RemainingTasks({ tasks, loading, failed, onRetry, today, weekStart, projects }: RemainingProps) {
  const [by, setBy] = useState<'due' | 'project'>('due')
  const [showUndated, setShowUndated] = useState(false)
  const complete = useCompleteTask()
  const groups = groupTasks(tasks, by, { today, weekStart, projects })
  // 마감순에서는 날짜 없는 업무를 접어 둔다(목업 "날짜 없는 업무 n개")
  const undated = by === 'due' ? groups.find((g) => g.key === 'none') : undefined
  // 100개까지 받아도 홈에는 마감순 앞 10개만 그린다. 나머지는 'n개 더'로 업무 화면에 넘긴다(UX-HOME-11)
  // 날짜 없는 업무는 직접 펼친 것이라 상한 밖에 두고 다 보인다. 상한에 걸려 펼쳐도 아무것도 안 나오면 안 된다
  const dated = groups.filter((g) => g !== undated)
  const before = dated.map((_, i) => dated.slice(0, i).reduce((n, g) => n + g.items.length, 0))
  const capped = dated
    .map((g, i) => ({ ...g, items: g.items.slice(0, Math.max(0, HOME_TASK_LIMIT - before[i])), total: g.items.length }))
    .filter((g) => g.items.length > 0)
  const shown = undated && showUndated ? [...capped, { ...undated, total: undated.items.length }] : capped
  const hiddenCount = dated.reduce((n, g) => n + g.items.length, 0) - HOME_TASK_LIMIT
  const projectOf = new Map(projects.map((p) => [p.id, p]))

  // 완료한 행이 목록에서 빠지면 포커스를 이웃 행의 완료 체크(없으면 제목)로 옮긴다. 그대로 두면 BODY로 빠진다
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<{ gone: string; next: string | null } | null>(null)
  useEffect(() => {
    const pending = focusAfter.current
    if (!pending || tasks.some((t) => t.id === pending.gone)) return
    // 결과 팝오버(SCR-TASK-03)가 포커스를 가졌으면 뺏지 않는다. 팝오버를 닫을 때 restoreFocus로 옮긴다
    if (isCompletionResultFocused()) return
    focusAfter.current = null
    const next = pending.next && document.querySelector<HTMLElement>(`[data-complete="${pending.next}"]`)
    ;(next || headingRef.current)?.focus()
  }, [tasks])

  const onComplete = async (task: Task) => {
    const visible = shown.flatMap((g) => g.items)
    const index = visible.findIndex((t) => t.id === task.id)
    const next = visible[index + 1] ?? visible[index - 1]
    focusAfter.current = { gone: task.id, next: next?.id ?? null }
    const restoreFocus = () => {
      const own = document.querySelector<HTMLElement>(`[data-complete="${task.id}"]`)
      if (own) return own.focus()
      const pending = focusAfter.current
      focusAfter.current = null
      const target = pending?.next && document.querySelector<HTMLElement>(`[data-complete="${pending.next}"]`)
      ;(target || headingRef.current)?.focus()
    }
    if (!(await complete(task, { returnFocus: restoreFocus }))) focusAfter.current = null
  }

  return (
    <section aria-labelledby="home-tasks" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="home-tasks" ref={headingRef} tabIndex={-1} className={styles.panelTitle}>
          남은 업무
        </h2>
        <div role="group" aria-label="묶기" className={styles.segment}>
          {(
            [
              ['due', '마감순'],
              ['project', '프로젝트'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={by === value}
              className={styles.segmentButton}
              onClick={() => setBy(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading && <Skeleton count={4} />}
      {failed && (
        <p role="alert" className={styles.error}>
          업무를 불러오지 못했어요
          <button
            type="button"
            className={styles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              onRetry()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {shown.map((g) => (
        <div key={g.key} className={styles.group}>
          <h3
            id={`home-group-${g.key}`}
            className={g.tone === 'danger' ? `${styles.groupTitle} ${styles.danger}` : styles.groupTitle}
          >
            {g.label} {g.total}
          </h3>
          <ul aria-labelledby={`home-group-${g.key}`} className={styles.rows}>
            {g.items.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.projectId ? projectOf.get(t.projectId) : undefined}
                today={today}
                weekStart={weekStart}
                onComplete={() => void onComplete(t)}
              />
            ))}
          </ul>
        </div>
      ))}
      {undated && (
        <button
          type="button"
          className={styles.undated}
          aria-expanded={showUndated}
          onClick={() => setShowUndated((v) => !v)}
        >
          {showUndated ? '날짜 없는 업무 접기' : `날짜 없는 업무 ${undated.items.length}개`}
        </button>
      )}
      <Link to="/tasks" className={styles.allLink}>
        {hiddenCount > 0 ? `업무 ${hiddenCount}개 더 보기` : '업무 전체 보기'}
      </Link>
    </section>
  )
}

function TaskRow(props: {
  task: Task
  project: Project | undefined
  today: string
  weekStart: number
  onComplete: () => void
}) {
  const { task, project, today, weekStart } = props
  const online = useOnline()
  const color = project ? projectColor(project.color) : null
  const state = dueState(task.dueDate, today, weekStart)
  const dueClass =
    state === 'overdue'
      ? `${styles.due} ${styles.dueLate}`
      : state === 'today'
        ? `${styles.due} ${styles.dueToday}`
        : styles.due
  return (
    <li className={state === 'overdue' ? `${styles.row} ${styles.rowLate}` : styles.row}>
      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-label={`${task.title} 완료`}
        data-complete={task.id}
        className={styles.check}
        style={color ? { borderColor: color.base } : undefined}
        disabled={!online}
        onClick={props.onComplete}
      />
      <Link to={`/tasks/${task.id}`} className={styles.rowBody}>
        <span className={styles.rowTitle} title={task.title}>
          {task.title}
        </span>
        <span className={styles.chips}>
          {project && color && (
            <span className={styles.chip} style={{ background: color.tint, color: color.ink }}>
              {project.name}
            </span>
          )}
          {task.dueDate && <span className={dueClass}>{dueLabel(task.dueDate, today)}</span>}
        </span>
      </Link>
    </li>
  )
}

type UpcomingEntry =
  | { kind: 'holiday'; key: string; date: string; title: string }
  | { kind: 'occurrence'; key: string; date: string; occurrence: Occurrence }

interface UpcomingProps {
  days: string[]
  byDate: Map<string, Occurrence[]>
  today: string
  timeZone: string
  loading: boolean
  failed: boolean
  onRetry: () => void
}

function Upcoming({ days, byDate, today, timeZone, loading, failed, onRetry }: UpcomingProps) {
  const projects = useProjects()
  const colorOf = (o: Occurrence) => {
    const p = o.projectId ? projects.data?.find((x) => x.id === o.projectId) : undefined
    return p ? projectColor(p.color) : null
  }

  // 오늘 일정은 ③에서만 보인다(UX-HOME-10). 다가오는 일정은 내일부터 7일
  // 여러 날에 걸친 일정은 기간 안의 첫날에 한 번만 보여 준다
  const entries: UpcomingEntry[] = []
  const seen = new Set<string>()
  for (const date of days) {
    if (date === today) continue
    const holiday = holidayName(date)
    if (holiday) entries.push({ kind: 'holiday', key: `holiday-${date}`, date, title: holiday })
    for (const o of byDate.get(date) ?? []) {
      const key = occurrenceKey(o)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ kind: 'occurrence', key, date, occurrence: o })
    }
  }
  const visible = entries.slice(0, UPCOMING_LIMIT)

  return (
    <section aria-labelledby="home-upcoming" className={styles.panel}>
      <h2 id="home-upcoming" className={styles.panelTitle}>
        다가오는 일정
      </h2>
      {loading && <Skeleton count={4} />}
      {failed && (
        <p role="alert" className={styles.error}>
          일정을 불러오지 못했어요
          <button
            type="button"
            className={styles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              onRetry()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {!loading && !failed && entries.length === 0 && <p className={styles.muted}>7일 안에 잡힌 일정이 없어요</p>}
      <ul className={styles.upcoming}>
        {visible.map((e) => {
          const color = e.kind === 'occurrence' ? colorOf(e.occurrence) : null
          const badgeStyle = color ? { background: color.tint, color: color.ink } : undefined
          return (
            <li key={e.key}>
              <Link to={`/calendar/day/${e.date}`} className={styles.upcomingItem}>
                <span
                  className={e.kind === 'holiday' ? `${styles.dayBadge} ${styles.dayHoliday}` : styles.dayBadge}
                  style={badgeStyle}
                  aria-hidden="true"
                >
                  <span className={styles.dayName}>
                    {e.date === today ? '오늘' : WEEKDAY_NAMES[isoWeekday(e.date) - 1]}
                  </span>
                  <span className={styles.dayNumber}>{Number(e.date.slice(8))}</span>
                </span>
                <span className={styles.upcomingText}>
                  <span className="visually-hidden">{shortDate(e.date, today)} </span>
                  <span className={styles.upcomingTitle} title={e.kind === 'holiday' ? e.title : e.occurrence.title}>
                    {e.kind === 'holiday' ? e.title : e.occurrence.title}
                  </span>
                  <span className={styles.upcomingTime}>
                    {e.kind === 'holiday' ? '공휴일' : timeText(e.occurrence, e.date, timeZone)}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {entries.length > UPCOMING_LIMIT && (
        <Link to={`/calendar/week/${today}`} className={styles.allLink}>
          일정 {entries.length - UPCOMING_LIMIT}개 더 · 캘린더에서 보기
        </Link>
      )}
    </section>
  )
}

/** 그날 기준 시간. 날을 넘는 일정은 그날 안쪽만 (캘린더 목록 보기와 같은 규칙) */
function timeText(o: Occurrence, date: string, timeZone: string) {
  if (o.allDay) return o.startDate === o.endDate ? '종일' : `종일 · ${shortDate(o.endDate!, todayIn(timeZone))}까지`
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  const start = s.date === date ? formatMinutes(s.minutes) : '00:00'
  const end = e.date === date ? formatMinutes(e.minutes) : '24:00'
  return `${start} – ${end}`
}

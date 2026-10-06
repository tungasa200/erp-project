// SCR-HOME-01 홈 대시보드 1차 (P1-11): ② 요약 카드 · ④ 남은 업무 · ⑥ 다가오는 일정.
// ③ 오늘 일정·확인 대기(P2)와 ⑤⑦ 일지(P3)는 아직 없다. 그래서 확인 대기 카드는 빼고(카드 3개),
// 다가오는 일정은 오늘 남은 일정부터 7일 뒤까지 보여 준다(pm 승인 가정).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { occurrenceKey, useOccurrences, type Occurrence } from '../calendar/api'
import { holidayName } from '../calendar/holidays'
import { occurrencesByDate } from '../calendar/layout'
import { formatMinutes, fromZoned, toZoned } from '../calendar/time'
import { useProjects, type Project } from '../projects/api'
import { projectColor } from '../projects/palette'
import { addDays, isoWeekday, shortDate, todayIn, WEEKDAY_NAMES, weekStartNumber } from '../quickInput/dates'
import { useTasks, type Task } from '../tasks/api'
import { useCompleteTask } from '../tasks/useCompleteTask'
import { DEFAULT_STATUSES, dueLabel, dueState, groupTasks } from '../tasks/view'
import styles from './home.module.css'

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

  return (
    <>
      <ul className={styles.cards} aria-label="요약">
        <SummaryCard
          to="/tasks"
          label="남은 업무"
          value={cardValue(remaining, `${remaining.items.length}${more(remaining)}`)}
          sub={overdue > 0 ? `마감 초과 ${overdue}건` : '마감 초과 없음'}
          accent
        />
        <SummaryCard
          to={`/calendar/day/${today}`}
          label="오늘 일정"
          value={cardValue(occurrences, String(todayList.length))}
          sub={todayList.length === 0 ? '일정 없음' : todayLeft === 0 ? '모두 끝났어요' : `${todayLeft}개 남았어요`}
        />
        <SummaryCard
          to="/tasks?status=DONE"
          label="이번 주 완료"
          value={cardValue(doneThisWeek, `${doneThisWeek.items.length}${more(doneThisWeek)}`)}
          sub={`${shortDate(weekFirst)}부터`}
        />
      </ul>

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
        <Upcoming
          days={days}
          byDate={byDate}
          today={today}
          timeZone={timeZone}
          isLive={notEnded}
          loading={occurrences.isPending}
          failed={occurrences.isError}
          onRetry={() => void occurrences.refetch()}
        />
      </div>
    </>
  )
}

/** 불러오는 중은 …, 실패하면 0 대신 — (없는 것으로 오해하지 않게) */
function cardValue(query: { isPending: boolean; isError: boolean }, value: string) {
  if (query.isError) return '—'
  return query.isPending ? '…' : value
}

/** 1분마다 바뀌는 현재 시각 (남은 일정 수·날짜 넘김) */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function SummaryCard(props: { to: string; label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <li>
      <Link to={props.to} className={props.accent ? `${styles.card} ${styles.cardAccent}` : styles.card}>
        <span className={styles.cardLabel}>{props.label}</span>
        <span className={styles.cardValue}>{props.value}</span>
        <span className={styles.cardSub}>{props.sub}</span>
      </Link>
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

function RemainingTasks({ tasks, loading, failed, onRetry, today, weekStart, projects }: RemainingProps) {
  const [by, setBy] = useState<'due' | 'project'>('due')
  const [showUndated, setShowUndated] = useState(false)
  const complete = useCompleteTask()
  const groups = groupTasks(tasks, by, { today, weekStart, projects })
  // 마감순에서는 날짜 없는 업무를 접어 둔다(목업 "날짜 없는 업무 n개")
  const undated = by === 'due' ? groups.find((g) => g.key === 'none') : undefined
  const shown = groups.filter((g) => g !== undated || showUndated)
  const projectOf = new Map(projects.map((p) => [p.id, p]))

  // 완료한 행이 목록에서 빠지면 포커스를 이웃 행의 완료 체크(없으면 제목)로 옮긴다. 그대로 두면 BODY로 빠진다
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<{ gone: string; next: string | null } | null>(null)
  useEffect(() => {
    const pending = focusAfter.current
    if (!pending || tasks.some((t) => t.id === pending.gone)) return
    focusAfter.current = null
    const next = pending.next && document.querySelector<HTMLElement>(`[data-complete="${pending.next}"]`)
    ;(next || headingRef.current)?.focus()
  }, [tasks])

  const onComplete = async (task: Task) => {
    const visible = shown.flatMap((g) => g.items)
    const index = visible.findIndex((t) => t.id === task.id)
    const next = visible[index + 1] ?? visible[index - 1]
    focusAfter.current = { gone: task.id, next: next?.id ?? null }
    if (!(await complete(task))) focusAfter.current = null
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
      {loading && <p className={styles.muted}>불러오는 중…</p>}
      {failed && (
        <p role="alert" className={styles.error}>
          업무를 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={onRetry}>
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
            {g.label} {g.items.length}
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
        업무 전체 보기
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
  isLive: (o: Occurrence) => boolean
  loading: boolean
  failed: boolean
  onRetry: () => void
}

function Upcoming({ days, byDate, today, timeZone, isLive, loading, failed, onRetry }: UpcomingProps) {
  const projects = useProjects()
  const colorOf = (o: Occurrence) => {
    const p = o.projectId ? projects.data?.find((x) => x.id === o.projectId) : undefined
    return p ? projectColor(p.color) : null
  }

  // 여러 날에 걸친 일정은 기간 안의 첫날에 한 번만 보여 준다
  const entries: UpcomingEntry[] = []
  const seen = new Set<string>()
  for (const date of days) {
    const holiday = holidayName(date)
    if (holiday) entries.push({ kind: 'holiday', key: `holiday-${date}`, date, title: holiday })
    for (const o of byDate.get(date) ?? []) {
      const key = occurrenceKey(o)
      if (seen.has(key) || (date === today && !isLive(o))) continue
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
      {loading && <p className={styles.muted}>불러오는 중…</p>}
      {failed && (
        <p role="alert" className={styles.error}>
          일정을 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={onRetry}>
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
                  <span className={styles.srOnly}>{shortDate(e.date)} </span>
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
  if (o.allDay) return o.startDate === o.endDate ? '종일' : `종일 · ${shortDate(o.endDate!)}까지`
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  const start = s.date === date ? formatMinutes(s.minutes) : '00:00'
  const end = e.date === date ? formatMinutes(e.minutes) : '24:00'
  return `${start} – ${end}`
}

// 캘린더 (SCR-CAL-01~05). 보기와 날짜는 URL이 기준이다: /calendar/{day|week|month|year}/:date, /calendar/list.
// 표시는 사용자의 현재 시간대(D-40), 주 시작 요일은 프로필 설정(AUTH-05)을 따른다.
// P1 범위 밖: 기록 상태(2.3)와 범례·일지 상태 점·이날의 기록 패널(P2 데이터), 상단 검색(일정 검색 API 없음).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useSingleKeyShortcuts } from '../shortcuts/useShortcuts'
import { useProjects } from '../projects/api'
import { useOccurrences, type Occurrence } from './api'
import { projectIdOf, useProjectColors } from './colors'
import { ListView } from './ListView'
import { MiniCalendar } from './MiniCalendar'
import { MonthView } from './MonthView'
import { QuickCreate, type CreateTarget, type ScheduleDraft } from './QuickCreate'
import { ScheduleDialog } from './ScheduleDialog'
import { ScopeDialog } from './ScopeDialog'
import { TimeGrid, type TimeRange } from './TimeGrid'
import { YearView } from './YearView'
import { shiftByDays, useScheduleActions, type Scope, type ScopeAction } from './useScheduleActions'
import {
  MINUTES_PER_DAY,
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  fromZoned,
  isValidDate,
  monthGridStart,
  startOfWeek,
  toZoned,
  todayIn,
  weekdayIndex,
  type Weekday,
} from './time'
import styles from './calendar.module.css'

export type CalendarView = 'day' | 'week' | 'month' | 'year' | 'list'

const VIEWS: { view: CalendarView; label: string; key: string }[] = [
  { view: 'day', label: '일', key: 'D' },
  { view: 'week', label: '주', key: 'W' },
  { view: 'month', label: '월', key: 'M' },
  { view: 'year', label: '연', key: 'Y' },
  { view: 'list', label: '목록', key: 'A' },
]

const LIST_WINDOW_DAYS = 30
const MAX_RANGE_DAYS = 400
const HIDDEN_PROJECTS_KEY = 'worklog.calendar.hiddenProjects'
const MOBILE_QUERY = '(max-width: 767px)'

function useCalendarPrefs() {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const weekStart = (user?.weekStart ?? 'MONDAY') as Weekday
  return { timeZone, weekStart }
}

/** 지금 시각(분 단위로 갱신) */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function calendarPath(view: CalendarView, date: string) {
  if (view === 'list') return '/calendar/list'
  if (view === 'month') return `/calendar/month/${date.slice(0, 7)}`
  if (view === 'year') return `/calendar/year/${date.slice(0, 4)}`
  return `/calendar/${view}/${date}`
}

/** /calendar → 오늘의 주 보기(모바일은 일 보기, 2.4) */
export function CalendarIndexRedirect() {
  const { timeZone } = useCalendarPrefs()
  const mobile = typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches
  return <Navigate to={calendarPath(mobile ? 'day' : 'week', todayIn(timeZone))} replace />
}

/** URL의 날짜 조각을 날짜로. 월은 1일, 연은 1월 1일 */
function parseDate(view: CalendarView, raw: string | undefined): string | null {
  if (view === 'month') return raw && isValidDate(`${raw}-01`) ? `${raw}-01` : null
  if (view === 'year') return raw && /^\d{4}$/.test(raw) ? `${raw}-01-01` : null
  return isValidDate(raw) ? raw : null
}

function loadHiddenProjects(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_PROJECTS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function CalendarPage() {
  const params = useParams()
  const { pathname } = useLocation()
  const view: CalendarView | null =
    params.view === undefined && pathname.endsWith('/list')
      ? 'list'
      : VIEWS.some((v) => v.view === params.view && v.view !== 'list')
        ? (params.view as CalendarView)
        : null
  const { timeZone, weekStart } = useCalendarPrefs()
  const today = todayIn(timeZone)
  const date = view === 'list' ? today : view ? parseDate(view, params.date) : null

  if (!view || !date) return <Navigate to={calendarPath('week', today)} replace />
  return <Calendar view={view} date={date} today={today} timeZone={timeZone} weekStart={weekStart} />
}

interface CalendarProps {
  view: CalendarView
  date: string
  today: string
  timeZone: string
  weekStart: Weekday
}

type Dialog = { kind: 'create'; draft: ScheduleDraft } | { kind: 'edit'; occurrence: Occurrence } | null

function Calendar({ view, date, today, timeZone, weekStart }: CalendarProps) {
  const navigate = useNavigate()
  const now = useNow()
  const projects = useProjects()
  const colorOf = useProjectColors()
  const [quick, setQuick] = useState<{ target: CreateTarget; anchor: { x: number; y: number } } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [scopeAsk, setScopeAsk] = useState<{
    occurrence: Occurrence
    action: ScopeAction
    resolve: (scope: Scope | null) => void
  } | null>(null)
  const [hiddenProjects, setHiddenProjects] = useState(loadHiddenProjects)
  const [listWindows, setListWindows] = useState({ past: 0, future: 2 })
  const mainRef = useRef<HTMLElement>(null)

  const askScope = useCallback(
    (occurrence: Occurrence, action: ScopeAction) =>
      new Promise<Scope | null>((resolve) => setScopeAsk({ occurrence, action, resolve })),
    [],
  )
  const actions = useScheduleActions(askScope)

  // ── 보기별 날짜 범위
  const days = useMemo(() => {
    const count = (n: number, first: string) => Array.from({ length: n }, (_, i) => addDays(first, i))
    if (view === 'day') return [date]
    if (view === 'week') return count(7, startOfWeek(date, weekStart))
    if (view === 'month') return count(42, monthGridStart(date, weekStart))
    if (view === 'year')
      return count(
        Math.round(
          (Date.UTC(Number(date.slice(0, 4)) + 1, 0, 1) - Date.UTC(Number(date.slice(0, 4)), 0, 1)) / 86_400_000,
        ),
        date,
      )
    return count(
      LIST_WINDOW_DAYS * (listWindows.past + listWindows.future),
      addDays(today, -LIST_WINDOW_DAYS * listWindows.past),
    )
  }, [view, date, weekStart, today, listWindows])
  const first = days[0]
  const last = days[days.length - 1]
  const query = useOccurrences(fromZoned(first, 0, timeZone), fromZoned(addDays(last, 1), 0, timeZone))
  const { visible } = actions
  const occurrences = useMemo(
    () =>
      visible(query.data ?? []).filter((o) => {
        const p = projectIdOf(o)
        return !p || !hiddenProjects.has(p)
      }),
    [visible, query.data, hiddenProjects],
  )

  const go = useCallback((v: CalendarView, d: string) => navigate(calendarPath(v, d)), [navigate])
  const step = (direction: 1 | -1) => {
    if (view === 'day') go(view, addDays(date, direction))
    else if (view === 'week') go(view, addDays(date, 7 * direction))
    else if (view === 'month') go(view, addMonths(date, direction))
    else if (view === 'year') go(view, addMonths(date, 12 * direction))
  }

  /** "일정 만들기"·C: 보고 있는 날의 다음 정시부터 1시간(오늘이 아니면 09시) */
  const openCreate = () => {
    const target = days.includes(today) ? today : date
    const nowMinutes = toZoned(now, timeZone).minutes
    const start = target === today ? Math.min(MINUTES_PER_DAY - 60, Math.ceil((nowMinutes + 1) / 60) * 60) : 9 * 60
    setDialog({ kind: 'create', draft: { title: '', date: target, start, end: start + 60, allDay: false } })
  }

  const openQuick = (target: CreateTarget) => {
    const rect = mainRef.current?.getBoundingClientRect()
    setQuick({ target, anchor: { x: (rect?.left ?? 0) + (rect?.width ?? 400) / 2 - 190, y: (rect?.top ?? 0) + 120 } })
  }

  useSingleKeyShortcuts({
    KeyD: () => go('day', date),
    KeyW: () => go('week', date),
    KeyM: () => go('month', date),
    KeyY: () => go('year', date),
    KeyA: () => go('list', date),
    KeyT: () => go(view, today),
    KeyJ: () => step(-1),
    KeyK: () => step(1),
    KeyC: openCreate,
  })

  // ── 제목
  const heading = (() => {
    const [y, m, d] = date.split('-').map(Number)
    if (view === 'day') return `${y}년 ${m}월 ${d}일 ${WEEKDAY_LABELS[weekdayIndex(date)]}요일`
    if (view === 'week') {
      const [, m1, d1] = first.split('-').map(Number)
      const [y2, m2, d2] = last.split('-').map(Number)
      return m1 === m2
        ? `${y}년 ${m1}월 ${d1}일 – ${d2}일`
        : `${y}년 ${m1}월 ${d1}일 – ${y2 !== y ? `${y2}년 ` : ''}${m2}월 ${d2}일`
    }
    if (view === 'month') return `${y}년 ${m}월`
    if (view === 'year') return `${y}년`
    return '다가오는 일정'
  })()

  const unit = { day: '날', week: '주', month: '달', year: '해', list: '' }[view]
  const rangeHighlight: [string, string] | null = view === 'week' ? [first, last] : view === 'day' ? [date, date] : null

  const toggleProject = (projectId: string) => {
    const next = new Set(hiddenProjects)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    setHiddenProjects(next)
    try {
      localStorage.setItem(HIDDEN_PROJECTS_KEY, JSON.stringify([...next]))
    } catch {
      // 저장하지 못해도 이번 화면에서는 적용된다
    }
  }

  const projectNameOf = (o: Occurrence) => {
    const id = projectIdOf(o)
    return (id && projects.data?.find((p) => p.id === id)?.name) || null
  }

  const createAllDay = (d: string) => openQuick({ date: d, start: 0, end: 0, allDay: true })

  const activeProjects = (projects.data ?? []).filter((p) => !p.archived)

  return (
    <div className={styles.page}>
      <aside className={styles.side} aria-label="캘린더 사이드바">
        <button type="button" className={styles.createButton} onClick={openCreate} title="단축키 C">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          일정 만들기
        </button>
        <MiniCalendar
          date={date}
          today={today}
          weekStart={weekStart}
          highlight={rangeHighlight}
          onSelect={(d) => go(view === 'list' || view === 'year' ? 'day' : view, d)}
        />
        {activeProjects.length > 0 && (
          <section className={styles.card} aria-labelledby="calendar-projects">
            <h2 id="calendar-projects" className={styles.cardTitle}>
              프로젝트
            </h2>
            {activeProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.filterItem}
                aria-pressed={!hiddenProjects.has(p.id)}
                onClick={() => toggleProject(p.id)}
                style={{ '--track-color': `var(--project-${p.color.toLowerCase()})` } as CSSProperties}
              >
                <span className={styles.filterTrack} aria-hidden="true" />
                {p.name}
              </button>
            ))}
          </section>
        )}
      </aside>

      <section ref={mainRef} className={styles.main} aria-labelledby="calendar-title">
        <div className={styles.toolbar}>
          <h1 id="calendar-title" className={styles.title} tabIndex={-1} data-focus-fallback>
            {heading}
          </h1>
          {view === 'list' ? (
            <button
              type="button"
              className={styles.pillButton}
              disabled={LIST_WINDOW_DAYS * (listWindows.past + listWindows.future + 1) > MAX_RANGE_DAYS}
              onClick={() => setListWindows((w) => ({ ...w, past: w.past + 1 }))}
            >
              지난 일정 보기
            </button>
          ) : (
            <>
              <button type="button" className={styles.pillButton} onClick={() => go(view, today)} title="단축키 T">
                오늘
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`이전 ${unit}`}
                title="단축키 J"
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`다음 ${unit}`}
                title="단축키 K"
                onClick={() => step(1)}
              >
                ›
              </button>
            </>
          )}
          <div className={styles.grow} />
          <nav className={styles.viewSwitch} aria-label="보기 전환">
            {VIEWS.map((v) => (
              <a
                key={v.view}
                href={calendarPath(v.view, date)}
                aria-current={v.view === view ? 'page' : undefined}
                title={`단축키 ${v.key}`}
                onClick={(e) => {
                  e.preventDefault()
                  go(v.view, date)
                }}
              >
                {v.label}
              </a>
            ))}
          </nav>
        </div>

        {(view === 'day' || view === 'week') && (
          <TimeGrid
            days={days}
            occurrences={occurrences}
            timeZone={timeZone}
            today={today}
            now={now}
            colorOf={colorOf}
            pending={quick && !quick.target.allDay ? (quick.target as TimeRange) : null}
            onCreate={(range) => openQuick({ ...range, allDay: false })}
            onCreateAllDay={createAllDay}
            onOpen={(o) => setDialog({ kind: 'edit', occurrence: o })}
            onMove={(o, change) => void actions.move(o, change)}
            onOpenDay={view === 'week' ? (d) => go('day', d) : undefined}
          />
        )}
        {view === 'month' && (
          <MonthView
            days={days}
            month={date.slice(0, 7)}
            occurrences={occurrences}
            timeZone={timeZone}
            today={today}
            colorOf={colorOf}
            onOpen={(o) => setDialog({ kind: 'edit', occurrence: o })}
            onOpenDay={(d) => go('day', d)}
            onCreateAllDay={createAllDay}
            onMoveDays={(o, n) => void actions.move(o, shiftByDays(o, n, timeZone))}
          />
        )}
        {view === 'year' && (
          <YearView
            year={Number(date.slice(0, 4))}
            occurrences={occurrences}
            timeZone={timeZone}
            today={today}
            weekStart={weekStart}
            onOpenDay={(d) => go('day', d)}
            onOpenMonth={(d) => go('month', d)}
          />
        )}
        {view === 'list' && (
          <ListView
            days={days}
            occurrences={occurrences}
            timeZone={timeZone}
            today={today}
            loading={query.isFetching}
            canLoadMore={LIST_WINDOW_DAYS * (listWindows.past + listWindows.future + 1) <= MAX_RANGE_DAYS}
            colorOf={colorOf}
            projectNameOf={projectNameOf}
            onOpen={(o) => setDialog({ kind: 'edit', occurrence: o })}
            onLoadMore={() => setListWindows((w) => ({ ...w, future: w.future + 1 }))}
          />
        )}
        {query.isError && (
          <p className={styles.empty} role="alert">
            일정을 불러오지 못했어요.{' '}
            <button type="button" className={styles.link} onClick={() => void query.refetch()}>
              다시 시도
            </button>
          </p>
        )}
      </section>

      {quick && (
        <QuickCreate
          target={quick.target}
          timeZone={timeZone}
          anchor={quick.anchor}
          onClose={() => setQuick(null)}
          onDetails={(draft) => {
            setQuick(null)
            setDialog({ kind: 'create', draft })
          }}
        />
      )}
      {dialog && (
        <ScheduleDialog
          key={dialog.kind === 'edit' ? `${dialog.occurrence.scheduleId}|${dialog.occurrence.occurrenceStart}` : 'new'}
          timeZone={timeZone}
          draft={dialog.kind === 'create' ? dialog.draft : undefined}
          occurrence={dialog.kind === 'edit' ? dialog.occurrence : undefined}
          askScope={askScope}
          onDelete={(o) => void actions.remove(o)}
          onClose={() => setDialog(null)}
        />
      )}
      {scopeAsk && (
        <ScopeDialog
          occurrence={scopeAsk.occurrence}
          action={scopeAsk.action}
          onClose={(scope) => {
            setScopeAsk(null)
            scopeAsk.resolve(scope)
          }}
        />
      )}
    </div>
  )
}

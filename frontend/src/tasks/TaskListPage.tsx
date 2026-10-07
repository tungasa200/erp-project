// SCR-TASK-01 업무 목록 (P1-03·04). 필터는 URL에 둔다. 행을 누르면 오른쪽 상세 패널(/tasks/:id)이 열린다.
// 완료 체크·Delete 보관은 확인창 없이 바로 하고 되돌리기 토스트를 띄운다(UX-03). 완료 결과 입력(SCR-TASK-03)은 P2.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { useProjects, useTags, type Project } from '../projects/api'
import { projectColor } from '../projects/palette'
import { todayIn, weekStartNumber } from '../quickInput/dates'
import { QuickInput } from '../quickInput/QuickInput'
import { refreshTasks, taskApi, useTasks, type Task } from './api'
import styles from './tasks.module.css'
import { useQuickSave } from './useQuickSave'
import {
  DEFAULT_STATUSES,
  DUE_PRESETS,
  dueLabel,
  dueState,
  groupTasks,
  PRIORITY_LABEL,
  readParams,
  STATUS_LABEL,
  STATUSES,
  toFilter,
  writeParams,
  type GroupBy,
  type ListParams,
} from './view'

const DAY_MS = 86_400_000

/** 상세 패널(TaskDetailPanel)에 넘기는 것: 보관 등으로 행이 빠지기 직전에 부른다 */
export interface TaskListOutletContext {
  leave: (taskId: string) => void
}

export function TaskListPage() {
  const { user } = useAuth()
  const { taskId } = useParams()
  const [search, setSearch] = useSearchParams()
  const params = readParams(search)
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  const weekStart = weekStartNumber(user?.weekStart)
  const [quickText, setQuickText] = useState('')
  const quickSave = useQuickSave()
  const online = useOnline()

  const projects = useProjects()
  const tags = useTags()
  const filter = toFilter(params, today, weekStart, timeZone)
  const mainEnabled = (filter.status?.length ?? 0) > 0
  const main = useTasks(filter, { enabled: mainEnabled })
  // 완료 업무 접기(최근 7일) — 상태 필터에 완료가 없을 때만. 완료를 골랐으면 본문에 바로 보인다 (P1-11-02)
  const showsDone = params.status.includes('DONE')
  const [since] = useState(() => new Date(Date.now() - 7 * DAY_MS).toISOString())
  const done = useTasks(
    { ...filter, status: ['DONE'], completedSince: since, sort: 'created' },
    { enabled: !showsDone },
  )
  const doneItems = showsDone ? [] : done.items
  const [doneOpen, setDoneOpen] = useState(false)

  const update = (next: Partial<ListParams>) => setSearch(writeParams({ ...params, ...next }), { replace: true })
  const filtered =
    params.project.length + params.tag.length + (params.due ? 1 : 0) + (params.completed ? 1 : 0) + (params.q ? 1 : 0) >
    0
  const groups = groupTasks(main.items, params.group, { today, weekStart, projects: projects.data ?? [] })
  const empty = !main.isPending && !main.isError && main.items.length === 0 && doneItems.length === 0

  // 완료 체크·Delete 보관으로 행이 목록에서 빠지면 포커스를 이웃 행의 완료 체크(없으면 제목)로 옮긴다.
  // 그대로 두면 BODY로 빠진다. 행은 다시 받은 목록에서 빠지므로 빠진 것을 확인한 뒤 옮긴다.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<{ gone: string; list: 'main' | 'done'; next: string | null } | null>(null)
  useEffect(() => {
    const pending = focusAfter.current
    if (!pending) return
    if ((pending.list === 'main' ? main.items : done.items).some((t) => t.id === pending.gone)) return
    focusAfter.current = null
    const next = pending.next && document.querySelector<HTMLElement>(`[data-complete="${pending.next}"]`)
    ;(next || headingRef.current)?.focus()
  }, [main.items, done.items])
  const leaving = (list: 'main' | 'done', visible: Task[], task: Task) => ({
    onLeave: () => {
      const index = visible.findIndex((t) => t.id === task.id)
      const next = visible[index + 1] ?? visible[index - 1]
      focusAfter.current = { gone: task.id, list, next: next?.id ?? null }
    },
    onStay: () => {
      focusAfter.current = null
    },
  })
  const mainVisible = groups.flatMap((g) => g.items)

  // 상세 패널을 닫으면 그 업무 행의 제목으로 포커스를 돌려준다(행이 없으면 목록 제목).
  // 패널에서 보관하면 패널이 leave를 먼저 불러, 행이 빠진 뒤 이웃 행으로 옮겨 간다.
  const openedTaskId = useRef(taskId)
  useEffect(() => {
    const closed = openedTaskId.current
    openedTaskId.current = taskId
    if (!closed || taskId) return
    // 패널에서 보관해 목록을 다시 받은 것이 먼저 끝났으면 이미 이웃 행으로 옮겼다. 포커스를 잃었을 때만 돌려준다
    if (document.activeElement && document.activeElement !== document.body) return
    const row = document.querySelector<HTMLElement>(`[data-row-link="${closed}"]`)
    ;(row ?? headingRef.current)?.focus()
  }, [taskId])
  const outletContext: TaskListOutletContext = {
    leave: (id) => {
      const inMain = main.items.some((t) => t.id === id)
      const task = (inMain ? main.items : done.items).find((t) => t.id === id)
      if (task) leaving(inMain ? 'main' : 'done', inMain ? mainVisible : done.items, task).onLeave()
    },
  }

  return (
    <div className={styles.layout}>
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            업무{' '}
            {mainEnabled && !main.isPending && (
              <span className={styles.count}>
                {main.items.length}
                {main.hasNextPage ? '+' : ''}
              </span>
            )}
          </h1>
        </div>

        {/* 끊긴 동안에는 추가를 막는다(SCR-SYS-02 ③). 검색·필터·열어 보기는 그대로 */}
        <fieldset className={styles.quickGuard} disabled={!online}>
          <QuickInput value={quickText} onChange={setQuickText} onSubmit={quickSave} label="업무 추가" />
        </fieldset>

        <div className={styles.toolbar}>
          <SearchBox value={params.q} onChange={(q) => update({ q })} />
          <FilterMenu
            label="상태"
            summary={params.status.map((s) => STATUS_LABEL[s]).join('·')}
            active={params.status.length > 0}
          >
            {STATUSES.map((s) => (
              <Check
                key={s}
                label={STATUS_LABEL[s]}
                checked={params.status.includes(s)}
                onChange={(on) => update({ status: on ? [...params.status, s] : params.status.filter((x) => x !== s) })}
              />
            ))}
          </FilterMenu>
          <FilterMenu
            label="프로젝트"
            summary={(projects.data ?? [])
              .filter((p) => params.project.includes(p.id))
              .map((p) => p.name)
              .join('·')}
            active={params.project.length > 0}
          >
            {(projects.data ?? []).map((p) => (
              <Check
                key={p.id}
                label={p.archived ? `${p.name} (보관)` : p.name}
                checked={params.project.includes(p.id)}
                onChange={(on) =>
                  update({ project: on ? [...params.project, p.id] : params.project.filter((x) => x !== p.id) })
                }
              />
            ))}
          </FilterMenu>
          <FilterMenu
            label="태그"
            summary={(tags.data ?? [])
              .filter((t) => params.tag.includes(t.id))
              .map((t) => `#${t.name}`)
              .join(' ')}
            active={params.tag.length > 0}
          >
            {(tags.data ?? []).map((t) => (
              <Check
                key={t.id}
                label={`#${t.name}`}
                checked={params.tag.includes(t.id)}
                onChange={(on) => update({ tag: on ? [...params.tag, t.id] : params.tag.filter((x) => x !== t.id) })}
              />
            ))}
          </FilterMenu>
          <FilterMenu
            label="마감 기간"
            summary={DUE_PRESETS.find((d) => d.value === params.due)?.label ?? ''}
            active={params.due !== ''}
          >
            {DUE_PRESETS.map((d) => (
              <Check
                key={d.value}
                type="radio"
                label={d.label}
                checked={params.due === d.value}
                onChange={() => update({ due: params.due === d.value ? '' : d.value })}
              />
            ))}
          </FilterMenu>
          {params.completed === 'week' && (
            // 홈 '이번 주 완료' 카드에서 온 기간 조건. 눌러서 지운다
            <button
              type="button"
              className={`${styles.filterButton} ${styles.filterActive}`}
              aria-label="완료 기간 조건 지우기: 이번 주부터"
              onClick={() => update({ completed: '' })}
            >
              완료: 이번 주부터 ×
            </button>
          )}
          <div className={styles.spacer} />
          <div role="group" aria-label="묶기" className={styles.segment}>
            {(
              [
                ['due', '마감순'],
                ['project', '프로젝트'],
                ['status', '상태'],
              ] as [GroupBy, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={params.group === value}
                className={styles.segmentButton}
                onClick={() => update({ group: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section aria-label="업무 목록" className={styles.listCard}>
          {main.isPending && mainEnabled && <Skeleton count={5} />}
          {main.isError && (
            <p role="alert" className={styles.error}>
              업무를 불러오지 못했어요
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  headingRef.current?.focus()
                  void main.refetch()
                }}
              >
                다시 시도
              </button>
            </p>
          )}
          {!mainEnabled && (
            <div className={styles.emptyState}>
              <p>상태를 하나 이상 골라 주세요</p>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  headingRef.current?.focus()
                  update({ status: DEFAULT_STATUSES })
                }}
              >
                기본 상태로
              </button>
            </div>
          )}
          {empty && !filtered && <EmptyGuide />}
          {empty && filtered && (
            <div className={styles.emptyState}>
              <p>조건에 맞는 업무가 없어요</p>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  headingRef.current?.focus()
                  update({ project: [], tag: [], due: '', completed: '', q: '' })
                }}
              >
                필터 지우기
              </button>
            </div>
          )}
          {groups.map((g) => (
            <TaskGroupList key={g.key} label={g.label} tone={g.tone} count={g.items.length}>
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  weekStart={weekStart}
                  projects={projects.data ?? []}
                  tagNames={new Map((tags.data ?? []).map((x) => [x.id, x.name]))}
                  selected={t.id === taskId}
                  {...leaving('main', mainVisible, t)}
                />
              ))}
            </TaskGroupList>
          ))}
          {main.hasNextPage && (
            <button
              type="button"
              className={styles.more}
              onClick={() => {
                // 마지막 쪽이면 버튼이 사라지므로 새로 받은 첫 행의 완료 체크로 포커스를 옮긴다
                const before = mainVisible.length
                void main
                  .fetchNextPage()
                  // 새 행은 다음 렌더에 그려진다
                  .then(() =>
                    setTimeout(() => document.querySelectorAll<HTMLElement>('[data-complete]')[before]?.focus()),
                  )
              }}
            >
              더 보기
            </button>
          )}
          {doneItems.length > 0 && (
            <div className={styles.doneBlock}>
              <button
                type="button"
                className={styles.smallButton}
                aria-expanded={doneOpen}
                onClick={() => setDoneOpen((open) => !open)}
              >
                완료 {done.items.length}
                {done.hasNextPage ? '+' : ''}개 (최근 7일) {doneOpen ? '접기' : '펼치기'}
              </button>
              {doneOpen && (
                <TaskGroupList label="완료" count={done.items.length}>
                  {done.items.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      today={today}
                      weekStart={weekStart}
                      projects={projects.data ?? []}
                      tagNames={new Map((tags.data ?? []).map((x) => [x.id, x.name]))}
                      selected={t.id === taskId}
                      {...leaving('done', done.items, t)}
                    />
                  ))}
                </TaskGroupList>
              )}
            </div>
          )}
        </section>
      </div>
      <Outlet context={outletContext} />
    </div>
  )
}

function EmptyGuide() {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyTitle}>아직 업무가 없어요</p>
      <p className={styles.muted}>위 입력창에 한 줄로 적어 보세요. 예: 견적서 회신 @영업 #결제 !높음 ~금</p>
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value)
  const [prev, setPrev] = useState(value)
  // 뒤로 가기 등으로 URL이 바뀌면 칸도 맞춘다
  if (prev !== value) {
    setPrev(value)
    setText(value)
  }
  // 입력이 멈추면 URL에 반영한다
  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => onChange(text.trim()), 300)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <label className={styles.search}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5" />
      </svg>
      <input
        type="search"
        aria-label="제목 검색"
        placeholder="제목 검색"
        maxLength={100}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  )
}

function FilterMenu({
  label,
  summary,
  active,
  children,
}: {
  label: string
  summary: string
  active: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  // 열면 첫 선택지로 포커스를 옮긴다(Esc로 닫으면 필터 버튼으로 돌아온다)
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLInputElement>('fieldset input')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={ref}
      className={styles.filter}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          ref.current?.querySelector('button')?.focus()
        }
      }}
    >
      <button
        type="button"
        className={active ? `${styles.filterButton} ${styles.filterActive}` : styles.filterButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {active && summary ? `${label}: ${summary}` : label}
      </button>
      {open && (
        <fieldset id={id} className={styles.filterMenu}>
          <legend className={styles.srOnly}>{label}</legend>
          {children}
        </fieldset>
      )}
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
  type = 'checkbox',
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  type?: 'checkbox' | 'radio'
}) {
  return (
    <label className={styles.check}>
      <input
        type={type}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onClick={() => type === 'radio' && checked && onChange(false)}
      />
      {label}
    </label>
  )
}

function TaskGroupList({
  label,
  tone,
  count,
  children,
}: {
  label: string
  tone?: 'danger' | 'muted'
  count: number
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className={styles.group}>
      <h2 id={id} className={tone ? `${styles.groupTitle} ${styles[tone]}` : styles.groupTitle}>
        {label} · {count}
      </h2>
      <ul aria-labelledby={id} className={styles.rows}>
        {children}
      </ul>
    </div>
  )
}

interface RowProps {
  task: Task
  today: string
  weekStart: number
  projects: Project[]
  tagNames: Map<string, string>
  selected: boolean
  /** 동작 직전에 부른다(행이 빠지면 포커스를 옮길 준비) */
  onLeave: () => void
  /** 동작이 실패하면 부른다 */
  onStay: () => void
}

function TaskRow({ task, today, weekStart, projects, tagNames, selected, onLeave, onStay }: RowProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { showToast, showUndo } = useToast()
  const project = projects.find((p) => p.id === task.projectId)
  const color = project ? projectColor(project.color) : null
  const done = task.status === 'DONE'
  const state = dueState(task.dueDate, today, weekStart)
  const refresh = () => refreshTasks(queryClient)
  const online = useOnline()

  const failed = (error: unknown) => {
    onStay()
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      refresh()
      showToast('다른 곳에서 먼저 수정돼서 새로 불러왔어요. 다시 해 주세요')
    } else {
      const { message, traceId } = toastForError(error)
      showToast(message, { traceId })
    }
  }

  const toggleDone = async () => {
    const before = task.status
    onLeave()
    try {
      const updated = await taskApi.update(task.id, { version: task.version, status: done ? 'TODO' : 'DONE' })
      refresh()
      showUndo({
        group: done ? 'reopen-task' : 'complete-task',
        message: (n) => (done ? `업무 ${n}개를 다시 열었어요` : `업무 ${n}개를 완료했어요`),
        undo: async () => {
          const latest = await taskApi.get(task.id)
          await taskApi.update(task.id, { version: latest.version, status: before })
          refresh()
        },
      })
      return updated
    } catch (error) {
      failed(error)
    }
  }

  const archive = async () => {
    onLeave()
    try {
      await taskApi.remove(task.id)
      refresh()
      if (selected) navigate({ pathname: '/tasks', search: search.toString() })
      showUndo({
        group: 'archive-task',
        message: (n) => `업무 ${n}개를 보관했어요`,
        undo: async () => {
          await taskApi.restore(task.id)
          refresh()
        },
      })
    } catch (error) {
      failed(error)
    }
  }

  const tagText = task.tagIds
    .map((id) => tagNames.get(id))
    .filter(Boolean)
    .map((n) => `#${n}`)
    .join(' ')

  return (
    <li
      className={[styles.row, selected && styles.rowSelected, !online && styles.rowOffline].filter(Boolean).join(' ')}
      onKeyDown={(e) => {
        // 행 안에 포커스가 있을 때 Delete로 보관 (입력칸 안의 Delete는 글자 지우기). 끊긴 동안에는 막는다
        if (online && e.key === 'Delete' && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault()
          void archive()
        }
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${task.title} 완료`}
        data-complete={task.id}
        disabled={!online}
        className={done ? `${styles.checkbox} ${styles.checkboxDone}` : styles.checkbox}
        style={color ? ({ '--check-color': color.base } as CSSProperties) : undefined}
        onClick={() => void toggleDone()}
      >
        {done && '✓'}
      </button>
      <Link
        to={{ pathname: `/tasks/${task.id}`, search: search.toString() }}
        data-row-link={task.id}
        className={done ? `${styles.rowTitle} ${styles.doneTitle}` : styles.rowTitle}
        title={task.title}
      >
        {task.title}
      </Link>
      <span className={task.priority === 'HIGH' ? `${styles.priority} ${styles.danger}` : styles.priority}>
        {PRIORITY_LABEL[task.priority]}
      </span>
      <span className={styles.projectCell}>
        {project && color && (
          <span className={styles.projectChip} style={{ background: color.tint, color: color.ink }}>
            {project.name}
          </span>
        )}
      </span>
      <span className={styles.tags}>{tagText}</span>
      <span className={state === 'overdue' && !done ? `${styles.due} ${styles.danger}` : styles.due}>
        {dueLabel(task.dueDate, today)}
      </span>
      <span className={styles.progress} aria-label={`진행률 ${task.progress}%`}>
        <span className={styles.progressBar}>
          <span style={{ width: `${task.progress}%`, background: color?.base ?? 'var(--color-accent)' }} />
        </span>
      </span>
      <span
        className={task.hasSchedule ? `${styles.schedule} ${styles.scheduleOn}` : styles.schedule}
        title={task.hasSchedule ? '일정에 배치됨' : '일정 없음'}
        aria-label={task.hasSchedule ? '일정에 배치됨' : '일정 없음'}
      >
        ◷
      </span>
    </li>
  )
}

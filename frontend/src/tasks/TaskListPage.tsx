// SCR-TASK-01 업무 목록 (P1-03·04). 필터는 URL에 둔다. 행을 누르면 오른쪽 상세 패널(/tasks/:id)이 열린다.
// 완료 체크·Delete 보관은 확인창 없이 바로 하고 되돌리기 토스트를 띄운다(UX-03). 완료하면 결과 입력 팝오버(SCR-TASK-03)도 띄운다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { inertOutside } from '../components/inertOutside'
import { Skeleton } from '../components/Skeleton'
import { closeByBack, useBackClose } from '../components/useBackClose'
import { useMediaQuery } from '../components/useMediaQuery'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { useProjects, useTags, type Project } from '../projects/api'
import { NewProjectInput } from '../projects/NewProjectInput'
import { projectColor } from '../projects/palette'
import { todayIn, weekStartNumber } from '../quickInput/dates'
import { QuickInput } from '../quickInput/QuickInput'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { clip, startFailedMessage, stoppedMessage, useRunningTimer, useTimerCommands } from '../timer/api'
import { refreshTasks, taskApi, useTasks, type Task } from './api'
import { isCompletionResultFocused } from './completionResultContext'
import styles from './tasks.module.css'
import { useCompleteTask } from './useCompleteTask'
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
  // 휴대폰 필터 시트가 열린 동안 고른 조건. 목록에는 바로 걸고 주소에는 시트를 닫을 때 한 번 쓴다(UX-M-TASK-101):
  // 열린 동안 주소를 바꾸면 시트가 쌓은 뒤로 가기 기록을 덮어써, 뒤로 가기가 필터를 풀거나 화면을 떠나지 못한다
  const [draft, setDraft] = useState<ListParams | null>(null)
  const params = draft ?? readParams(search)
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  const weekStart = weekStartNumber(user?.weekStart)
  const [quickText, setQuickText] = useState('')
  // 만든 업무가 프로젝트·태그·검색 필터에 걸려 목록에 없으면 토스트로 알리고 필터를 풀 길을 준다(UX-TASK-140).
  // 마감 필터는 날짜 계산이 서버 몫이라 보지 않는다
  const quickSave = useQuickSave(({ task }) => {
    const q = params.q.trim().toLowerCase()
    const hidden =
      (params.project.length > 0 && !params.project.includes(task.projectId ?? '')) ||
      (params.tag.length > 0 && !task.tagIds.some((id) => params.tag.includes(id))) ||
      (q !== '' && !task.title.toLowerCase().includes(q))
    return hidden ? '/tasks' : null
  })
  const online = useOnline()
  // 방금 만든 업무. 목록 어디(그룹 맨 아래 등)에 들어가든 그 줄을 화면 가운데로 가져와 잠깐 강조한다(UX-TASK-60).
  // 가운데로 두면 화면 아래 되돌리기 토스트에도 가리지 않는다
  const [justAdded, setJustAdded] = useState<string | null>(null)
  useEffect(() => {
    if (!justAdded) return
    let row: HTMLElement | null = null
    // 다시 받은 목록에 줄이 생길 때까지 잠깐 기다린다
    const find = setInterval(() => {
      row = document.querySelector<HTMLElement>(`[data-task-id="${justAdded}"]`)
      if (!row) return
      clearInterval(find)
      row.scrollIntoView?.({ block: 'center' })
      row.setAttribute('data-just-added', '')
    }, 100)
    const end = setTimeout(() => {
      clearInterval(find)
      row?.removeAttribute('data-just-added')
      setJustAdded(null)
    }, 3000)
    return () => {
      clearInterval(find)
      clearTimeout(end)
      row?.removeAttribute('data-just-added')
    }
  }, [justAdded])

  const projects = useProjects()
  const tags = useTags()
  const filter = toFilter(params, today, weekStart, timeZone)
  const mobile = useMediaQuery('(max-width: 767px)')
  const [filterSheet, setFilterSheet] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  // [필터 (n)]의 n: 기본(할 일·진행 중)과 다른 조건 수. 묶기는 조건이 아니라 세지 않는다
  const defaultStatus =
    params.status.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every((x) => params.status.includes(x))
  const applied = [
    !defaultStatus,
    params.project.length > 0,
    params.tag.length > 0,
    params.due !== '',
    params.completed !== '',
  ].filter(Boolean).length
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

  const update = (next: Partial<ListParams>) =>
    draft ? setDraft({ ...draft, ...next }) : setSearch(writeParams({ ...params, ...next }), { replace: true })

  // X-11: 화면 안 추가는 지금 조건을 미리 채운 같은 빠른 입력이다. 프로젝트·태그를 하나씩 골랐으면 @·# 칩으로 미리 넣는다
  // (공백 있는 이름은 한 낱말로 쓸 수 없어 뺀다). 사용자가 아직 고치지 않았으면 조건이 바뀔 때 함께 바뀐다
  const word = (mark: string, name: string | undefined) => (name && !/\s/.test(name) ? `${mark}${name} ` : '')
  const filterProject = params.project.length === 1 ? projects.data?.find((p) => p.id === params.project[0]) : undefined
  const seed =
    word('@', filterProject && !filterProject.archived ? filterProject.name : undefined) +
    word('#', params.tag.length === 1 ? tags.data?.find((t) => t.id === params.tag[0])?.name : undefined)
  const [lastSeed, setLastSeed] = useState('')
  if (seed !== lastSeed) {
    setLastSeed(seed)
    if (quickText === lastSeed) setQuickText(seed)
  }
  // 새 업무는 '할 일'로 만들어진다. 그 상태를 보지 않는 보기(완료만 등)에서는 만들어도 목록에 안 보이므로 추가를 끄고 이유를 보인다
  const addBlocked = !params.status.includes('TODO')
    ? params.status.length === 0
      ? '상태를 하나도 고르지 않아 새 업무를 만들 수 없어요'
      : `${params.status.map((st) => STATUS_LABEL[st]).join('·')} 보기에서는 새 업무를 만들 수 없어요`
    : null
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
    // 결과 팝오버가 포커스를 가졌으면 뺏지 않는다. 팝오버를 닫을 때 restoreFocus로 옮긴다
    if (isCompletionResultFocused()) return
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
    // 결과 팝오버를 닫을 때: 행이 남아 있으면 그 완료 체크로(빠지면 위 effect가 이웃으로 옮긴다), 없으면 이웃 행·목록 제목으로
    restoreFocus: () => {
      const own = document.querySelector<HTMLElement>(`[data-complete="${task.id}"]`)
      if (own) return own.focus()
      const pending = focusAfter.current
      focusAfter.current = null
      const next = pending?.next && document.querySelector<HTMLElement>(`[data-complete="${pending.next}"]`)
      ;(next || headingRef.current)?.focus()
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

  // 필터 조건과 묶기. 데스크톱은 도구 줄에 펼치고, 휴대폰은 [필터 (n)] 시트 안에 같은 것을 둔다
  const conditions = (
    <>
      <FilterMenu
        inline={mobile}
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
        inline={mobile}
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
        {mobile && <SheetProjectActions />}
      </FilterMenu>
      <FilterMenu
        inline={mobile}
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
        inline={mobile}
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
    </>
  )
  const grouping = (
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
  )

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
        <fieldset
          className={styles.quickGuard}
          disabled={!online || addBlocked !== null}
          aria-describedby={addBlocked ? 'task-add-blocked' : undefined}
        >
          <QuickInput
            value={quickText}
            onChange={setQuickText}
            onSubmit={async (draft) => {
              setJustAdded((await quickSave(draft)).task.id)
              // 저장하면 입력은 비워진다. 같은 조건으로 이어 쓰게 칩을 다시 채운다
              setTimeout(() => setQuickText((text) => (text === '' ? seed : text)))
            }}
            label="업무 추가"
            placeholder="할 일을 한 줄로 적어 보세요"
          />
        </fieldset>
        {addBlocked && (
          <p id="task-add-blocked" className={styles.addBlocked}>
            {addBlocked}
          </p>
        )}

        {mobile ? (
          // 휴대폰: 검색과 [필터 (n)] 한 줄, 조건·묶기는 하단 시트로 접는다(UX-M-TASK-43·46, D-223 ③)
          <div className={styles.toolbar}>
            <SearchBox value={params.q} onChange={(q) => update({ q })} />
            <button
              ref={filterButton}
              type="button"
              className={applied > 0 ? `${styles.filterButton} ${styles.filterActive}` : styles.filterButton}
              aria-haspopup="dialog"
              onClick={() => {
                setDraft(params)
                setFilterSheet(true)
              }}
            >
              {applied > 0 ? `필터 (${applied})` : '필터'}
            </button>
          </div>
        ) : (
          <div className={styles.toolbar}>
            <SearchBox value={params.q} onChange={(q) => update({ q })} />
            {conditions}
            <div className={styles.spacer} />
            {grouping}
          </div>
        )}
        {mobile && filterSheet && (
          <FilterSheet
            onClose={() => {
              setFilterSheet(false)
              // 시트 기록을 걷어 낸 뒤(뒤로 가기·closeByBack) 불리므로 아래 화면 기록의 주소를 고친다
              if (draft) setSearch(writeParams(draft), { replace: true })
              setDraft(null)
              // 시트가 사라져 뒤 화면의 inert가 풀린 뒤에 옮긴다(그 전에는 버튼이 포커스를 받지 못한다)
              setTimeout(() => filterButton.current?.focus())
            }}
          >
            {conditions}
            <p className={styles.sheetLegend} aria-hidden="true">
              묶기
            </p>
            {grouping}
          </FilterSheet>
        )}

        <section aria-label="업무 목록" className={styles.listCard}>
          {main.isPending && mainEnabled && <Skeleton count={5} offlineText="연결되면 업무를 불러올게요" />}
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
          {/* SCR-TASK-04 보관함(P4-10)으로 가는 길 */}
          <Link to="/tasks/archive" className={styles.archiveLink}>
            보관함
            <span aria-hidden="true">›</span>
          </Link>
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
  inline = false,
  children,
}: {
  label: string
  summary: string
  active: boolean
  /** 필터 시트 안: 펼친 선택지 묶음으로 */
  inline?: boolean
  children: ReactNode
}) {
  if (inline)
    return (
      <fieldset className={styles.sheetGroup}>
        <legend className={styles.sheetLegend}>{label}</legend>
        {children}
      </fieldset>
    )
  return (
    <FilterDropdown label={label} summary={summary} active={active}>
      {children}
    </FilterDropdown>
  )
}

function FilterDropdown({
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
          <legend className="visually-hidden">{label}</legend>
          {children}
        </fieldset>
      )}
    </div>
  )
}

// 휴대폰 필터 시트(UX-M-TASK-43, D-223 ③). 고르는 즉시 목록에 걸리고 [완료]·바깥·Esc·뒤로 가기로 닫는다.
// 어느 쪽으로 닫든 시트 기록을 뒤로 가기로 먼저 걷고 닫아서, 고른 조건은 화면 기록에 남고 다음 뒤로 가기는 화면을 떠난다(UX-M-TASK-101)
function FilterSheet({ onClose: closed, children }: { onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLElement>(null)
  const titleId = useId()
  useBackClose(true, closed)
  const onClose = () => {
    if (!closeByBack()) closed()
  }
  useEffect(() => {
    if (!sheet.current) return
    sheet.current.querySelector<HTMLElement>('h2')?.focus()
    return inertOutside(sheet.current)
  }, [])
  return (
    <div className={`${styles.sheetScrim} wy-scrim`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${styles.sheet} wy-sheet`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id={titleId} tabIndex={-1} className={styles.sheetTitle}>
          필터
        </h2>
        {children}
        <button type="button" className={styles.sheetDone} onClick={onClose}>
          완료
        </button>
      </section>
    </div>
  )
}

// 휴대폰 필터 시트의 프로젝트 묶음 맨 아래: '+ 새 프로젝트'(그 자리 이름 칸)·'프로젝트 관리'(D-226). 데스크톱은 사이드바에 있다
function SheetProjectActions() {
  const online = useOnline()
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.sheetProjectActions}>
      {adding ? (
        <NewProjectInput
          onDone={() => {
            setAdding(false)
            setTimeout(() => addButton.current?.focus())
          }}
        />
      ) : (
        <button
          ref={addButton}
          type="button"
          className={styles.sheetAction}
          disabled={!online}
          onClick={() => setAdding(true)}
        >
          + 새 프로젝트
        </button>
      )}
      <Link to="/settings/projects" className={styles.sheetAction}>
        프로젝트 관리
      </Link>
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
  /** 완료 결과 팝오버를 닫을 때 부른다 */
  restoreFocus: () => void
}

function TaskRow({ task, today, weekStart, projects, tagNames, selected, onLeave, onStay, restoreFocus }: RowProps) {
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
  const complete = useCompleteTask()
  const timed = useTimeTracking()

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
    if (!done) {
      if (!(await complete(task, { returnFocus: restoreFocus }))) onStay()
      return
    }
    try {
      const updated = await taskApi.update(task.id, { version: task.version, status: 'TODO' })
      refresh()
      showUndo({
        group: 'reopen-task',
        message: (n) => `업무 ${n}개를 다시 열었어요`,
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

  /** 보관(Delete 키·[⋯] 메뉴). 실패하면 false */
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
      return true
    } catch (error) {
      failed(error)
      return false
    }
  }

  const tagText = task.tagIds
    .map((id) => tagNames.get(id))
    .filter(Boolean)
    .map((n) => `#${n}`)
    .join(' ')

  return (
    <li
      data-task-id={task.id}
      className={[styles.row, timed && styles.rowTimed, selected && styles.rowSelected, !online && styles.rowOffline]
        .filter(Boolean)
        .join(' ')}
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
        {/* 좁아져 우선순위 칸이 숨으면 '높음'만 점으로 남긴다(UX-TASK-61) */}
        {task.priority === 'HIGH' && <span className={styles.highDot} role="img" aria-label="높음" />}
        {task.title}
      </Link>
      {/* 기본값(보통)·마감 없음·진행 0은 비워 예외만 눈에 띄게 한다(UX-TASK-61) */}
      <span className={task.priority === 'HIGH' ? `${styles.priority} ${styles.danger}` : styles.priority}>
        {task.priority === 'NORMAL' ? '' : PRIORITY_LABEL[task.priority]}
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
        {task.dueDate ? dueLabel(task.dueDate, today) : ''}
      </span>
      <span className={styles.progress} aria-label={`진행률 ${task.progress}%`}>
        {task.progress > 0 && (
          <span className={styles.progressBar}>
            <span style={{ width: `${task.progress}%`, background: color?.base ?? 'var(--color-accent)' }} />
          </span>
        )}
      </span>
      {/* 꺼진 ◷는 대비 1.6:1로 흐릿하기만 해서 빼고, 일정에 놓인 업무만 표시한다(UX-TASK-62) */}
      {task.hasSchedule ? (
        <span className={`${styles.schedule} ${styles.scheduleOn}`} title="일정에 배치됨" aria-label="일정에 배치됨">
          ◷
        </span>
      ) : (
        <span className={styles.schedule} />
      )}
      {timed && <TimerStartCell task={task} />}
      <RowMenu title={task.title} online={online} onArchive={archive} />
    </li>
  )
}

// 줄 오른쪽 [⋯] 메뉴(사용자 결정 2026-10-13, 데스크톱·휴대폰 같음). 지금은 [보관] 하나: Delete 키·상세 패널 [보관]과 같은 동작.
// 타이머 시작은 줄의 ▶를 그대로 둔다. 열면 첫 항목으로, Esc·바깥 누르기로 닫히면 [⋯]로 포커스. 보관하면 행이 빠져 이웃 행으로 간다
function RowMenu({ title, online, onArchive }: { title: string; online: boolean; onArchive: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  // 끊기면 열린 메뉴도 닫는다(보관은 끊긴 동안 막는다)
  if (open && !online) setOpen(false)

  useEffect(() => {
    if (!open) return
    // ':scope >': 행 자체가 목록(ul) 안이라 'ul button'은 [⋯]도 잡는다
    wrap.current?.querySelector<HTMLElement>(':scope > ul button')?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={wrap}
      className={styles.rowMenu}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.rowMenuButton}
        aria-label={`${title} 메뉴`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={online ? '메뉴' : '연결되면 쓸 수 있어요'}
        disabled={!online}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <ul id={id} className={styles.rowMenuList} aria-label={`${title} 메뉴`}>
          <li>
            <button
              type="button"
              className={styles.rowMenuItem}
              onClick={async () => {
                setOpen(false)
                // 실패하면 행이 남으므로 [⋯]로 돌아온다
                if (!(await onArchive())) button.current?.focus()
              }}
            >
              보관
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

// 업무에서 바로 타이머 시작(P2-06 사용자 결정 2026-10-07: 업무 목록 진입점). 시간 기록 옵션이 켜져 있을 때만.
// 다른 타이머가 돌고 있으면 서버가 먼저 정지한다(동시 1개). 이 업무가 이미 돌고 있으면 '실행 중'으로 막는다
function TimerStartCell({ task }: { task: Task }) {
  const online = useOnline()
  const running = useRunningTimer().data ?? null
  const { start } = useTimerCommands()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  if (task.status === 'DONE') return <span />
  const mine = running?.taskId === task.id

  const onStart = async () => {
    if (busy || mine) return
    setBusy(true)
    try {
      const { running: started, stopped } = await start({ taskId: task.id })
      const before = stopped ? `${stoppedMessage(stopped)} · ` : ''
      showToast(`${before}‘${clip(started.content)}’ 타이머를 시작했어요`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) showToast('업무를 찾지 못했어요. 보관됐을 수 있어요')
      else {
        const known = startFailedMessage(error)
        const { message, traceId } = toastForError(error)
        showToast(known ?? message, known ? undefined : { traceId })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={mine ? `${styles.timerStart} ${styles.timerRunning}` : styles.timerStart}
      aria-label={mine ? `${task.title} 타이머 실행 중` : `${task.title} 타이머 시작`}
      title={mine ? '타이머 실행 중' : online ? '타이머 시작' : '연결되면 시작할 수 있어요'}
      // 누른 버튼이 막히며 포커스를 잃지 않게 시작 중·실행 중은 aria-disabled로만 막는다(끊김은 disabled)
      disabled={!online}
      aria-disabled={busy || mine || undefined}
      onClick={() => void onStart()}
    >
      <span aria-hidden="true">{mine ? '●' : '▶'}</span>
    </button>
  )
}

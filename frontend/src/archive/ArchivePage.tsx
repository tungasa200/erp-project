// SCR-TASK-04 보관함 (TASK-08, NFR-05 · P4-10). 보관(소프트 삭제)한 업무와 보관한 프로젝트를 모아 복원한다. 영구 삭제는 없다.
// API는 이미 있다: 업무 GET /tasks?deleted=true · POST /tasks/{id}/restore, 프로젝트 GET /projects?includeArchived=true · PATCH archived=false.
// 복원한 줄이 빠지면 앱 셸의 포커스 안전망이 같은 목록의 이웃 [복원]으로, 없으면 화면 제목으로 옮긴다(data-focus-list).
import { useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { useAuth } from '../auth/useAuth'
import { WEEKDAY_LABELS, formatMinutes, toZoned, weekdayIndex } from '../calendar/time'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { Skeleton } from '../components/Skeleton'
import { PROJECTS_QUERY_KEY, projectApi, useProjects, type Project } from '../projects/api'
import { projectColor } from '../projects/palette'
import { refreshTasks, taskApi, useTasks, type Task } from '../tasks/api'
import styles from './archive.module.css'

type Kind = 'tasks' | 'projects'

/** 10/6 화 17:40 (사용자 시간대) */
function archivedAt(instant: string | null | undefined, timeZone: string): string {
  if (!instant) return ''
  const { date, minutes } = toZoned(instant, timeZone)
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d} ${WEEKDAY_LABELS[weekdayIndex(date)]} ${formatMinutes(minutes)}`
}

const byArchivedDesc =
  <T,>(at: (item: T) => string | null | undefined) =>
  (a: T, b: T) =>
    (at(b) ?? '').localeCompare(at(a) ?? '')

export function ArchivePage() {
  const id = useId()
  const { user } = useAuth()
  const timeZone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [search, setSearch] = useSearchParams()
  const kind: Kind = search.get('type') === 'projects' ? 'projects' : 'tasks'

  // 계약에 보관 시각 정렬이 없어 받은 만큼을 보관 시각 역순으로 놓는다(더 받으면 다시 정렬)
  const tasks = useTasks({ deleted: true, sort: 'created' })
  const projectsQuery = useProjects()
  const allProjects = projectsQuery.data ?? []
  const archivedProjects = allProjects.filter((p) => p.archived).sort(byArchivedDesc((p: Project) => p.archivedAt))
  const archivedTasks = [...tasks.items].sort(byArchivedDesc((t: Task) => t.deletedAt))

  const taskCount = tasks.isPending ? '' : tasks.hasNextPage ? `${archivedTasks.length}+` : String(archivedTasks.length)
  const projectCount = projectsQuery.isPending ? '' : String(archivedProjects.length)
  const nothing =
    !tasks.isPending &&
    !tasks.isError &&
    !projectsQuery.isPending &&
    !projectsQuery.isError &&
    archivedTasks.length === 0 &&
    archivedProjects.length === 0

  const tabs: { kind: Kind; label: string; count: string }[] = [
    { kind: 'tasks', label: '업무', count: taskCount },
    { kind: 'projects', label: '프로젝트', count: projectCount },
  ]
  const tabRefs = useRef<Record<Kind, HTMLButtonElement | null>>({ tasks: null, projects: null })
  const select = (next: Kind, focus = false) => {
    setSearch(next === 'projects' ? { type: 'projects' } : {}, { replace: true })
    if (focus) tabRefs.current[next]?.focus()
  }
  // 탭 목록: ←/→·Home/End로 옮기며 바로 고른다(자동 활성화)
  const onTabKey = (e: KeyboardEvent) => {
    // 탭이 둘이라 ←·→ 모두 다른 쪽으로 간다
    const other: Kind = kind === 'tasks' ? 'projects' : 'tasks'
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowLeft'
        ? other
        : e.key === 'Home'
          ? 'tasks'
          : e.key === 'End'
            ? 'projects'
            : null
    if (!next) return
    e.preventDefault()
    select(next, true)
  }

  return (
    <div className={styles.page}>
      <Link to="/tasks" className={styles.back}>
        <span aria-hidden="true">← </span>업무
      </Link>
      <h1 className={styles.title} tabIndex={-1}>
        보관함
      </h1>
      <p className={styles.lead}>보관한 업무와 프로젝트를 되돌릴 수 있어요. 탈퇴 전까지 사라지지 않아요.</p>
      {nothing ? (
        <section className={styles.empty} aria-label="보관한 항목">
          <p className={styles.emptyTitle}>보관한 항목이 없어요</p>
          <p className={styles.muted}>업무나 프로젝트를 보관하면 여기에 모여요.</p>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="종류" className={styles.tabs} onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button
                key={t.kind}
                ref={(el) => {
                  tabRefs.current[t.kind] = el
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${t.kind}`}
                aria-selected={kind === t.kind}
                aria-controls={`${id}-panel`}
                tabIndex={kind === t.kind ? 0 : -1}
                className={styles.tab}
                onClick={() => select(t.kind)}
              >
                {t.label}
                {t.count && ` ${t.count}`}
              </button>
            ))}
          </div>
          <section role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${kind}`} className={styles.panel}>
            {kind === 'tasks' ? (
              <TaskList
                tasks={archivedTasks}
                projects={allProjects}
                timeZone={timeZone}
                pending={tasks.isPending}
                error={tasks.isError}
                onRetry={() => void tasks.refetch()}
                hasMore={tasks.hasNextPage}
                loadingMore={tasks.isFetchingNextPage}
                onMore={() => void tasks.fetchNextPage()}
              />
            ) : (
              <ProjectList
                projects={archivedProjects}
                timeZone={timeZone}
                pending={projectsQuery.isPending}
                error={projectsQuery.isError}
                onRetry={() => void projectsQuery.refetch()}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

interface ListState {
  pending: boolean
  error: boolean
  onRetry: () => void
}

function ListStatus({ pending, error, onRetry, empty }: ListState & { empty: string }) {
  if (pending) return <Skeleton shape="lines" count={4} offlineText="연결되면 보관함을 불러올게요" />
  if (error)
    return (
      <p role="alert" className={styles.error}>
        보관함을 불러오지 못했어요
        <button type="button" className={styles.softButton} onClick={onRetry}>
          다시 시도
        </button>
      </p>
    )
  return <p className={styles.muted}>{empty}</p>
}

/** [복원]: 끊긴 동안은 막는다(보낼 수 없음). 실패는 토스트 */
function useRestore(onFail?: () => void) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, action: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await action()
      showToast(done)
    } catch (err) {
      const { message, traceId } = toastForError(err)
      showToast(message, { traceId })
      onFail?.()
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function TaskList(
  props: ListState & {
    tasks: Task[]
    projects: Project[]
    timeZone: string
    hasMore: boolean
    loadingMore: boolean
    onMore: () => void
  },
) {
  const queryClient = useQueryClient()
  const online = useOnline()
  const { busy, run } = useRestore()
  // 다시 받다 실패해도 받아 둔 줄은 그대로 둔다
  if (props.tasks.length === 0) return <ListStatus {...props} empty="보관한 업무가 없어요" />
  return (
    <>
      <ul className={styles.list} data-focus-list>
        {props.tasks.map((t) => {
          const project = t.projectId ? props.projects.find((p) => p.id === t.projectId) : undefined
          const color = project ? projectColor(project.color) : null
          return (
            <li key={t.id} className={styles.item}>
              <span className={styles.name}>{t.title}</span>
              {project && color && (
                <span className={styles.chip} style={{ background: color.tint, color: color.ink }}>
                  {project.name}
                  {project.archived && <span className={styles.chipNote}> · 보관함</span>}
                </span>
              )}
              <span className={styles.when}>{archivedAt(t.deletedAt, props.timeZone)} 보관</span>
              <button
                type="button"
                className={styles.restore}
                data-focus-item
                disabled={!online || busy === t.id}
                aria-label={`${t.title} 복원`}
                onClick={() =>
                  void run(
                    t.id,
                    async () => {
                      await taskApi.restore(t.id)
                      refreshTasks(queryClient)
                    },
                    `업무를 복원했어요`,
                  )
                }
              >
                복원
              </button>
            </li>
          )
        })}
      </ul>
      {props.hasMore && (
        <button type="button" className={styles.more} disabled={props.loadingMore || !online} onClick={props.onMore}>
          {props.loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </>
  )
}

function ProjectList(props: ListState & { projects: Project[]; timeZone: string }) {
  const queryClient = useQueryClient()
  const online = useOnline()
  // 다른 곳에서 고쳐 version이 어긋났으면(409) 새 version으로 다시 받아 다음 복원이 맞게 가도록
  const { busy, run } = useRestore(() => void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY }))
  if (props.projects.length === 0) return <ListStatus {...props} empty="보관한 프로젝트가 없어요" />
  return (
    <ul className={styles.list} data-focus-list>
      {props.projects.map((p) => {
        const color = projectColor(p.color)
        return (
          <li key={p.id} className={styles.item}>
            <span className={styles.name}>
              <span className={styles.swatch} style={{ background: color.base }} aria-hidden="true" />
              {p.name}
            </span>
            <span className={styles.count}>업무 {p.taskCount}개</span>
            <span className={styles.when}>{archivedAt(p.archivedAt, props.timeZone)} 보관</span>
            <button
              type="button"
              className={styles.restore}
              data-focus-item
              disabled={!online || busy === p.id}
              aria-label={`${p.name} 복원`}
              onClick={() =>
                void run(
                  p.id,
                  async () => {
                    await projectApi.update(p.id, { version: p.version, archived: false })
                    // 프로젝트를 되돌리면 그 업무들도 업무 목록·사이드바에 다시 보인다
                    void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
                    refreshTasks(queryClient)
                  },
                  `프로젝트를 복원했어요`,
                )
              }
            >
              복원
            </button>
          </li>
        )
      })}
    </ul>
  )
}

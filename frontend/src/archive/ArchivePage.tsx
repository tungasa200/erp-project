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
import { objectParticle } from '../palette/particle'
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
      {/* 마지막 줄을 복원해도 탭은 남기고 탭마다 빈 상태를 보인다(TASK-04s ①) */}
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
    </div>
  )
}

interface ListState {
  pending: boolean
  error: boolean
  onRetry: () => void
}

interface Empty {
  title: string
  text: string
  to: string
  link: string
}

const EMPTY_TASKS: Empty = {
  title: '보관한 업무가 없어요',
  text: '끝난 업무를 목록에서 치우고 싶을 때 업무의 ⋯ 메뉴에서 보관하세요. 기록과 일지는 그대로 남아요.',
  to: '/tasks',
  link: '업무로 가기',
}

const EMPTY_PROJECTS: Empty = {
  title: '보관한 프로젝트가 없어요',
  text: '설정 › 프로젝트·태그에서 보관할 수 있어요.',
  to: '/settings/projects',
  link: '프로젝트·태그 설정으로 가기',
}

function ListStatus({ pending, error, onRetry, empty }: ListState & { empty: Empty }) {
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
  return (
    <div className={styles.emptyState}>
      <svg
        aria-hidden="true"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.emptyIcon}
      >
        <path d="M3 7h18v13H3zM2 3h20v4H2zM10 12h4" />
      </svg>
      <p className={styles.emptyTitle}>{empty.title}</p>
      <p className={styles.muted}>{empty.text}</p>
      <Link to={empty.to} className={styles.emptyLink}>
        {empty.link}
      </Link>
    </div>
  )
}

/**
 * [복원]: 끊긴 동안은 막는다(보낼 수 없음). 실패는 토스트. 보내는 동안은 disabled 대신 aria-disabled로 막는다:
 * disabled는 포커스를 먼저 놓아 버려, 줄이 빠진 뒤 앱 셸 안전망이 이웃·제목으로 옮겨 주지 못한다
 */
function useRestore(onFail?: () => void) {
  const { showToast, showUndo } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const sending = useRef(false)
  /** 복원하고 "'{이름}'을 복원했어요 · 되돌리기"(되돌리기 = 다시 보관, SCR-COM-04 규칙) */
  const run = async <T,>(
    key: string,
    action: () => Promise<T>,
    done: { group: string; name: string; unit: string; undo: (restored: T) => Promise<void> },
  ) => {
    if (sending.current) return
    sending.current = true
    setBusy(key)
    try {
      const restored = await action()
      showUndo({
        group: done.group,
        message: (n) =>
          n > 1 ? `${done.unit} ${n}개를 복원했어요` : `'${done.name}'${objectParticle(done.name)} 복원했어요`,
        undo: () => done.undo(restored),
      })
    } catch (err) {
      const { message, traceId } = toastForError(err)
      showToast(message, { traceId })
      onFail?.()
    } finally {
      sending.current = false
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
  if (props.tasks.length === 0) return <ListStatus {...props} empty={EMPTY_TASKS} />
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
                disabled={!online}
                aria-disabled={busy === t.id || undefined}
                aria-label={`${t.title} 복원`}
                onClick={() =>
                  void run(
                    t.id,
                    async () => {
                      await taskApi.restore(t.id)
                      refreshTasks(queryClient)
                    },
                    {
                      group: 'archive-restore-task',
                      name: t.title,
                      unit: '업무',
                      undo: async () => {
                        await taskApi.remove(t.id)
                        refreshTasks(queryClient)
                      },
                    },
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
  if (props.projects.length === 0) return <ListStatus {...props} empty={EMPTY_PROJECTS} />
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
              disabled={!online}
              aria-disabled={busy === p.id || undefined}
              aria-label={`${p.name} 복원`}
              onClick={() =>
                void run(
                  p.id,
                  async () => {
                    const restored = await projectApi.update(p.id, { version: p.version, archived: false })
                    // 프로젝트를 되돌리면 그 업무들도 업무 목록·사이드바에 다시 보인다
                    void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
                    refreshTasks(queryClient)
                    return restored
                  },
                  {
                    group: 'archive-restore-project',
                    name: p.name,
                    unit: '프로젝트',
                    undo: async (restored) => {
                      await projectApi.update(p.id, { version: restored.version, archived: true })
                      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
                      refreshTasks(queryClient)
                    },
                  },
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

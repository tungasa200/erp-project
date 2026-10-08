// 업무 목록 표시 규칙 (SCR-TASK-01): 마감 상태·묶기·URL 필터. 마감 임박·초과는 사용자 시간대의 오늘로 계산한다(계약).
import { fromZoned } from '../calendar/time'
import type { Project } from '../projects/api'
import { addDays, isoWeekday, shortDate } from '../quickInput/dates'
import type { Task, TaskFilter, TaskStatus } from './api'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  ON_HOLD: '보류',
}
export const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'ON_HOLD']
export const PRIORITY_LABEL: Record<Task['priority'], string> = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' }

/** 목록 기본 상태 (목업 TASK-01: "상태: 할 일·진행 중") */
export const DEFAULT_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS']

export type DueState = 'overdue' | 'today' | 'week' | 'later' | 'none'

/** 사용자 주 시작일 기준 이번 주 첫날 */
export function weekFirst(today: string, weekStart: number): string {
  return addDays(today, -((isoWeekday(today) - weekStart + 7) % 7))
}

function weekEnd(today: string, weekStart: number): string {
  const startOfWeek = addDays(today, -((isoWeekday(today) - weekStart + 7) % 7))
  return addDays(startOfWeek, 6)
}

export function dueState(due: string | null | undefined, today: string, weekStart: number): DueState {
  if (!due) return 'none'
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return due <= weekEnd(today, weekStart) ? 'week' : 'later'
}

export function dueLabel(due: string | null | undefined, today: string): string {
  if (!due) return '—'
  if (due === today) return '오늘'
  if (due === addDays(today, 1)) return '내일'
  return shortDate(due, today)
}

export type GroupBy = 'due' | 'project' | 'status'

export interface TaskGroup {
  key: string
  label: string
  tone?: 'danger' | 'muted'
  items: Task[]
}

const DUE_GROUPS: { state: DueState; label: string; tone?: TaskGroup['tone'] }[] = [
  { state: 'overdue', label: '마감 초과', tone: 'danger' },
  { state: 'today', label: '오늘' },
  { state: 'week', label: '이번 주' },
  { state: 'later', label: '다음' },
  { state: 'none', label: '날짜 없음', tone: 'muted' },
]

export function groupTasks(
  tasks: Task[],
  by: GroupBy,
  context: { today: string; weekStart: number; projects: Project[] },
): TaskGroup[] {
  if (by === 'due') {
    return DUE_GROUPS.map((g) => ({
      key: g.state,
      label: g.label,
      tone: g.tone,
      items: tasks.filter((t) => dueState(t.dueDate, context.today, context.weekStart) === g.state),
    })).filter((g) => g.items.length > 0)
  }
  if (by === 'status') {
    return STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], items: tasks.filter((t) => t.status === s) })).filter(
      (g) => g.items.length > 0,
    )
  }
  // 프로젝트: 만든 순서, 프로젝트 없음은 맨 뒤
  const groups: TaskGroup[] = context.projects
    .map((p) => ({ key: p.id, label: p.name, items: tasks.filter((t) => t.projectId === p.id) }))
    .filter((g) => g.items.length > 0)
  const known = new Set(context.projects.map((p) => p.id))
  const rest = tasks.filter((t) => !t.projectId || !known.has(t.projectId))
  if (rest.length) groups.push({ key: 'none', label: '프로젝트 없음', tone: 'muted', items: rest })
  return groups
}

/** URL의 필터 (/tasks?project=…&status=…). 새로 고침·뒤로 가기에도 남는다 */
export interface ListParams {
  status: TaskStatus[]
  project: string[]
  tag: string[]
  due: '' | 'overdue' | 'today' | 'week'
  /** 완료 업무의 완료 시각 기간. week = 이번 주 첫날부터 (홈 '이번 주 완료' 카드) */
  completed: '' | 'week'
  q: string
  group: GroupBy
}

export const DUE_PRESETS: { value: ListParams['due']; label: string }[] = [
  { value: 'overdue', label: '마감 초과' },
  { value: 'today', label: '오늘까지' },
  { value: 'week', label: '이번 주까지' },
]

export function readParams(search: URLSearchParams): ListParams {
  const status = search.getAll('status').filter((s): s is TaskStatus => STATUSES.includes(s as TaskStatus))
  const due = search.get('due')
  const group = search.get('group')
  return {
    status: search.has('status') ? status : DEFAULT_STATUSES,
    project: search.getAll('project'),
    tag: search.getAll('tag'),
    due: due === 'overdue' || due === 'today' || due === 'week' ? due : '',
    completed: search.get('completed') === 'week' ? 'week' : '',
    q: search.get('q') ?? '',
    group: group === 'project' || group === 'status' ? group : 'due',
  }
}

export function writeParams(params: ListParams): URLSearchParams {
  const search = new URLSearchParams()
  const sameAsDefault =
    params.status.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every((s) => params.status.includes(s))
  if (!sameAsDefault) {
    if (params.status.length === 0) search.append('status', '')
    params.status.forEach((s) => search.append('status', s))
  }
  params.project.forEach((p) => search.append('project', p))
  params.tag.forEach((t) => search.append('tag', t))
  if (params.due) search.set('due', params.due)
  if (params.completed) search.set('completed', params.completed)
  if (params.q) search.set('q', params.q)
  if (params.group !== 'due') search.set('group', params.group)
  return search
}

/** 화면 필터를 API 조건으로. 상태에 완료가 있으면 완료 업무도 본문에 보인다(없으면 목록 아래 "최근 7일" 묶음) */
export function toFilter(params: ListParams, today: string, weekStart: number, timeZone: string): TaskFilter {
  const dueTo =
    params.due === 'overdue'
      ? addDays(today, -1)
      : params.due === 'today'
        ? today
        : params.due === 'week'
          ? weekEnd(today, weekStart)
          : undefined
  return {
    status: params.status,
    projectId: params.project.length ? params.project : undefined,
    tagId: params.tag.length ? params.tag : undefined,
    dueTo,
    // 완료 업무만 거른다(완료가 아닌 업무에는 영향 없음, 계약)
    completedSince: params.completed === 'week' ? fromZoned(weekFirst(today, weekStart), 0, timeZone) : undefined,
    q: params.q || undefined,
    sort: 'due',
  }
}

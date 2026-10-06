// 업무 API (TASK-01~06, P1-03·04). 캘린더 업무 패널(P1-08, frontend2)도 이 모듈을 쓴다.
// 쿼리 키는 모두 ['tasks', …]로 시작하므로 invalidateQueries({ queryKey: TASKS_QUERY_KEY })로 한꺼번에 다시 받는다.
import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import { OCCURRENCES_QUERY_KEY, scheduleApi } from '../calendar/api'
import { PROJECTS_QUERY_KEY } from '../projects/api'

type Schemas = components['schemas']
export type Task = Schemas['Task']
export type TaskCreate = Schemas['TaskCreate']
export type TaskPatch = Schemas['TaskPatch']
export type TaskStatus = Task['status']
export type TaskPriority = Task['priority']

/** GET /api/worklog/tasks 조건. 배열은 OR (?status=TODO&status=DONE) */
export interface TaskFilter {
  status?: TaskStatus[]
  projectId?: string[]
  tagId?: string[]
  dueFrom?: string
  dueTo?: string
  completedSince?: string
  q?: string
  deleted?: boolean
  scheduled?: boolean
  sort?: 'due' | 'created'
  limit?: number
}

export interface TaskPage {
  items: Task[]
  nextCursor?: string | null
}

export const TASKS_QUERY_KEY = ['tasks'] as const
export const taskListKey = (filter: TaskFilter) => ['tasks', 'list', filter] as const
export const taskKey = (id: string) => ['tasks', 'detail', id] as const

/** 업무를 만들거나 상태·프로젝트를 바꾼 뒤 업무 목록과 프로젝트의 남은 업무 수(사이드바 openTaskCount)를 다시 받는다 */
export function refreshTasks(queryClient: QueryClient, key: readonly unknown[] = TASKS_QUERY_KEY) {
  void queryClient.invalidateQueries({ queryKey: key })
  void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
}

function query(filter: TaskFilter, cursor?: string): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)))
    else params.set(key, String(value))
  }
  if (cursor) params.set('cursor', cursor)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const taskApi = {
  list: (filter: TaskFilter = {}, cursor?: string) =>
    api.request<TaskPage>(`/api/worklog/tasks${query(filter, cursor)}`),
  get: (id: string) => api.request<Task>(`/api/worklog/tasks/${id}`),
  create: (body: TaskCreate) => api.request<Task>('/api/worklog/tasks', { method: 'POST', body }),
  update: (id: string, body: TaskPatch) => api.request<Task>(`/api/worklog/tasks/${id}`, { method: 'PATCH', body }),
  /** 보관(소프트 삭제). 되돌리기는 restore */
  remove: (id: string) => api.request<void>(`/api/worklog/tasks/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api.request<Task>(`/api/worklog/tasks/${id}/restore`, { method: 'POST' }),
}

/** 커서로 이어 받는 목록. pages를 펼친 items도 함께 준다 */
export function useTasks(filter: TaskFilter, options: { enabled?: boolean } = {}) {
  const result = useInfiniteQuery({
    queryKey: taskListKey(filter),
    queryFn: ({ pageParam }) => taskApi.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options.enabled,
  })
  const items = result.data?.pages.flatMap((p) => p.items) ?? []
  return { ...result, items }
}

export function useTask(id: string | undefined) {
  return useQuery({ queryKey: taskKey(id ?? ''), queryFn: () => taskApi.get(id!), enabled: Boolean(id) })
}

/**
 * 이 업무에 연결된 일정의 회차 [from, to) (GET /schedules?taskId=, 결정 A·P1-05-06).
 * 키가 ['occurrences', …]로 시작해 캘린더에서 일정을 바꾸면 함께 다시 받는다.
 */
export function useTaskOccurrences(taskId: string, from: string, to: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...OCCURRENCES_QUERY_KEY, 'task', taskId, from, to],
    enabled: options.enabled,
    queryFn: async () => (await scheduleApi.occurrences(from, to, taskId)).items,
  })
}

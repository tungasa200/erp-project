// 프로젝트·태그 API (TASK-04, P1-02).
// TODO(P1-02 worklog 스냅샷): projects·tags가 스냅샷에 들어오면 아래 임시 타입을 생성 타입으로 바꾼다.
// 그때까지는 contracts/worklog.yaml 확정본(bc20241)을 따른다.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export type ProjectColor = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8'

export interface Project {
  id: string
  name: string
  color: ProjectColor
  archived: boolean
  archivedAt?: string | null
  taskCount: number
  createdAt: string
  version: number
}

export interface ProjectCreate {
  name: string
  color: ProjectColor
}

export interface ProjectPatch {
  version: number
  name?: string
  color?: ProjectColor
  archived?: boolean
}

export interface Tag {
  id: string
  name: string
  usageCount: number
  createdAt: string
  version: number
}

export const PROJECTS_QUERY_KEY = ['projects'] as const
export const TAGS_QUERY_KEY = ['tags'] as const

export const projectApi = {
  // 설정 화면은 보관한 프로젝트 수도 보여 주므로 함께 받는다.
  list: () => api.request<{ items: Project[] }>('/api/worklog/projects?includeArchived=true'),
  create: (body: ProjectCreate) => api.request<Project>('/api/worklog/projects', { method: 'POST', body }),
  update: (id: string, body: ProjectPatch) =>
    api.request<Project>(`/api/worklog/projects/${id}`, { method: 'PATCH', body }),
}

export const tagApi = {
  list: () => api.request<{ items: Tag[] }>('/api/worklog/tags'),
  rename: (id: string, body: { version: number; name: string }) =>
    api.request<Tag>(`/api/worklog/tags/${id}`, { method: 'PATCH', body }),
  remove: (id: string, options: { keepalive?: boolean } = {}) =>
    api.request<void>(`/api/worklog/tags/${id}`, { method: 'DELETE', keepalive: options.keepalive }),
}

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: async () => (await projectApi.list()).items })
}

export function useTags() {
  return useQuery({ queryKey: TAGS_QUERY_KEY, queryFn: async () => (await tagApi.list()).items })
}

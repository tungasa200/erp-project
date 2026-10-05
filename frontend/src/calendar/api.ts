// 일정 API (SCH-02·03, P1-05·06). 계약은 contracts/worklog.yaml 일정 절.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']
export type Occurrence = Schemas['Occurrence']
export type Schedule = Schemas['Schedule']
export type ScheduleCreate = Schemas['ScheduleCreate']
export type SchedulePatch = Schemas['SchedulePatch']
export type OccurrencePatch = Schemas['OccurrencePatch']
export type Recurrence = Schemas['Recurrence']

export const OCCURRENCES_QUERY_KEY = ['occurrences'] as const

const base = '/api/worklog/schedules'
const occurrencePath = (scheduleId: string, occurrenceStart: string) =>
  `${base}/${scheduleId}/occurrences/${encodeURIComponent(occurrenceStart)}`

export const scheduleApi = {
  /** [from, to)와 겹치는 회차. 기간은 최대 400일 */
  occurrences: (from: string, to: string) =>
    api.request<{ items: Occurrence[] }>(`${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  get: (id: string) => api.request<Schedule>(`${base}/${id}`),
  create: (body: ScheduleCreate) => api.request<Schedule>(base, { method: 'POST', body }),
  /** 반복 일정이면 "모든 일정" */
  update: (id: string, body: SchedulePatch) => api.request<Schedule>(`${base}/${id}`, { method: 'PATCH', body }),
  // 지연 삭제(D-72)는 페이지를 떠날 때도 끝까지 가도록 keepalive를 받는다
  remove: (id: string, options: { keepalive?: boolean } = {}) =>
    api.request<void>(`${base}/${id}`, { method: 'DELETE', keepalive: options.keepalive }),
  /** 반복 일정의 "이 일정만" */
  updateOccurrence: (scheduleId: string, occurrenceStart: string, body: OccurrencePatch) =>
    api.request<Occurrence>(occurrencePath(scheduleId, occurrenceStart), { method: 'PATCH', body }),
  removeOccurrence: (scheduleId: string, occurrenceStart: string, options: { keepalive?: boolean } = {}) =>
    api.request<void>(occurrencePath(scheduleId, occurrenceStart), { method: 'DELETE', keepalive: options.keepalive }),
}

/** 회차를 가리키는 키. 회차를 옮겨도 occurrenceStart는 바뀌지 않는다(D-71) */
export const occurrenceKey = (o: Pick<Occurrence, 'scheduleId' | 'occurrenceStart'>) =>
  `${o.scheduleId}|${o.occurrenceStart}`

export function useOccurrences(from: string, to: string) {
  return useQuery({
    queryKey: [...OCCURRENCES_QUERY_KEY, from, to],
    queryFn: async () => (await scheduleApi.occurrences(from, to)).items,
    placeholderData: (previous) => previous,
  })
}

/** 일정 변경 뒤 모든 기간의 회차를 다시 받는다(반복 일정은 여러 기간에 걸친다) */
export function useInvalidateOccurrences() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: OCCURRENCES_QUERY_KEY })
}

export function useCreateSchedule() {
  const invalidate = useInvalidateOccurrences()
  return useMutation({ mutationFn: scheduleApi.create, onSuccess: invalidate })
}

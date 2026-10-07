// SCR-REC-01 기록 추가·수정이 쓰는 API (P2-01 계약 contracts/worklog.yaml records/{recordId}).
// 공용 records/api.ts(WY-frontend)는 만들기·보관만 갖고 있어 조회·수정·복원·같은 날 목록을 여기 둔다.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import type { WorkRecord } from './api'

export type WorkRecordPatch = components['schemas']['WorkRecordPatch']

export const recordEditApi = {
  /** 보관한 기록도 돌려준다(deletedAt) */
  get: (id: string) => api.request<WorkRecord>(`/api/worklog/records/${id}`),
  update: (id: string, body: WorkRecordPatch) =>
    api.request<WorkRecord>(`/api/worklog/records/${id}`, { method: 'PATCH', body }),
  restore: (id: string) => api.request<WorkRecord>(`/api/worklog/records/${id}/restore`, { method: 'POST' }),
  /** 같은 날 기록(시간 겹침 경고, TIME-06). 확인 대기·하지 않음은 실제로 한 일이 아니라 뺀다 */
  day: (date: string) =>
    api.request<components['schemas']['WorkRecordList']>(
      `/api/worklog/records?from=${date}&to=${date}&status=CONFIRMED`,
    ),
}

export function useRecord(id: string | undefined) {
  return useQuery({
    queryKey: ['records', 'one', id],
    queryFn: () => recordEditApi.get(id!),
    enabled: !!id,
    gcTime: 0,
  })
}

export function useDayRecords(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['records', 'day', date],
    queryFn: () => recordEditApi.day(date),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    select: (d) => d.items,
  })
}

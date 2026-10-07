// 업무 기록 API (REC-01·02, P2-01 계약 contracts/worklog.yaml records).
// 쿼리 키는 모두 ['records', …]로 시작하므로 invalidateQueries({ queryKey: RECORDS_QUERY_KEY })로 한꺼번에 다시 받는다.
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']
export type WorkRecord = Schemas['WorkRecord']
export type WorkRecordCreate = Schemas['WorkRecordCreate']
export type WorkRecordOutcome = NonNullable<WorkRecord['outcome']>

export const RECORDS_QUERY_KEY = ['records'] as const

export const recordApi = {
  /** 직접 쓴 기록은 서버가 바로 확정(CONFIRMED)으로 만든다 */
  create: (body: WorkRecordCreate) => api.request<WorkRecord>('/api/worklog/records', { method: 'POST', body }),
  /** 보관(소프트 삭제) */
  remove: (id: string) => api.request<void>(`/api/worklog/records/${id}`, { method: 'DELETE' }),
}

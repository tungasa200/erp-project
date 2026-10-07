// 확인 대기 기록 (REC-03, P2-03 계약 D-100). 홈 요약 카드·띠와 SCR-HOME-02가 같은 쿼리를 쓴다.
// 서버가 GET 때 끝난 회차의 확인 대기를 만들므로, 개수는 늘 이 목록의 길이다(최근 7일).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']
export type PendingRecord = Schemas['PendingRecord']
type WorkRecord = Schemas['WorkRecord']
type RecordStatus = WorkRecord['status']

/** ['records', …] 아래라 기록을 바꾸는 곳이 RECORDS_QUERY_KEY로 무효화하면 함께 다시 받는다 */
export const PENDING_QUERY_KEY = ['records', 'pending'] as const

export const pendingApi = {
  list: () => api.request<Schemas['PendingRecordList']>('/api/worklog/records/pending'),
  /** 보낸 id만 확정한다(화면에 보인 것만). 응답은 이번에 확정한 기록 */
  confirm: (ids: string[]) =>
    api.request<Schemas['WorkRecordList']>('/api/worklog/records/pending/confirm', { method: 'POST', body: { ids } }),
  /** 했어요 = CONFIRMED, 안 했어요 = DISMISSED, 되돌리기 = PENDING */
  setStatus: (id: string, status: RecordStatus, version: number) =>
    api.request<WorkRecord>(`/api/worklog/records/${id}`, { method: 'PATCH', body: { status, version } }),
}

export function usePendingRecords() {
  return useQuery({ queryKey: PENDING_QUERY_KEY, queryFn: pendingApi.list, select: (d) => d.items })
}

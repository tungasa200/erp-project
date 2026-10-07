// SCR-HOME-03 빈 시간 메우기 (P2-07, TIME-11) 데이터. 빈 구간·후보는 서버가 계산한다(GET /records/gaps).
// 채우기는 기존 API: 새 기록은 POST /records(구간), 이 시간 계획에 확인 대기가 있으면 그 기록을 PATCH해 확정한다(같은 계획을 두 번 세지 않게).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import type { WorkRecord } from '../records/api'
import { recordApi } from '../records/api'

export type TimeGap = components['schemas']['TimeGap']

export function useTimeGaps(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['records', 'gaps', date],
    queryFn: () => api.request<components['schemas']['TimeGapList']>(`/api/worklog/records/gaps?date=${date}`),
    select: (d) => d.items,
    enabled,
  })
}

export type GapChoice =
  | { kind: 'previous' | 'frequent' | 'direct'; content: string; taskId: string | null }
  | { kind: 'plan'; plan: NonNullable<TimeGap['plan']> }

/** 구간을 채운다. 성공하면 만든·확정한 기록과 그것을 되돌리는 함수를 돌려준다 */
export async function fillGap(
  gap: TimeGap,
  choice: GapChoice,
): Promise<{ saved: WorkRecord; undo: () => Promise<unknown> }> {
  const span = { startAt: gap.startAt, endAt: gap.endAt }
  const created = async (record: Promise<WorkRecord>) => {
    const saved = await record
    return { saved, undo: () => recordApi.remove(saved.id) }
  }
  if (choice.kind !== 'plan') {
    return created(recordApi.create({ content: choice.content, taskId: choice.taskId, ...span }))
  }
  const { plan } = choice
  if (!plan.pendingRecordId) {
    return created(recordApi.create({ content: plan.title, taskId: plan.taskId, ...span }))
  }
  const url = `/api/worklog/records/${plan.pendingRecordId}`
  const pending = await api.request<WorkRecord>(url)
  const saved = await api.request<WorkRecord>(url, {
    method: 'PATCH',
    body: { ...span, status: 'CONFIRMED', version: pending.version },
  })
  // 확인 대기로 되돌리면 채운 시간 칸도 확정 전 값으로 돌린다. workDate는 시작이 없을 때의 날짜라 함께 보낸다
  const undo = () =>
    api.request<WorkRecord>(url, {
      method: 'PATCH',
      body: {
        status: 'PENDING',
        startAt: pending.startAt ?? null,
        endAt: pending.endAt ?? null,
        durationMin: pending.durationMin ?? null,
        workDate: pending.workDate,
        version: saved.version,
      },
    })
  return { saved, undo }
}

/** 기간 시간 집계(GET /records/time-summary). 홈은 오늘 합계만 쓴다 */
export function useTimeSummary(from: string, to: string) {
  return useQuery({
    queryKey: ['records', 'time-summary', from, to],
    queryFn: () =>
      api.request<components['schemas']['TimeSummary']>(`/api/worklog/records/time-summary?from=${from}&to=${to}`),
  })
}

/** 45분, 1시간, 1시간 30분 */
export function durationText(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`
}

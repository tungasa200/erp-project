// 통계 API (STAT-01·UX-05, P4-02, SCR-STAT-01). contracts/worklog.yaml 0.6.0의 GET /stats·/stats/plan-vs-actual.
// 소요시간 비중(⑤)은 기존 GET /records/time-summary를 같은 기간으로 부른다(home/gaps.ts useTimeSummary).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']

/** daily는 from부터 to까지 하루도 빠짐없이(0 포함) 날짜순. 주·월 막대는 화면이 묶는다.
 * firstRecordDate는 기간과 무관한 첫 확정 기록 — "1주일 기록이 쌓이면" 판단은 화면이 한다 */
export type Stats = Schemas['Stats']
/** 업무 없는 기록·프로젝트 없는 업무는 projectId null */
export type StatsProject = Schemas['StatsProject']
/** actualMin은 그 주 예상이 있는 업무의 실제 합, unplannedMin은 예상 없는 업무·업무 없는 기록의 실제 합 */
export type PlanVsActualWeek = Schemas['PlanVsActualWeek']
export type PlanVsActualTask = Schemas['PlanVsActualTask']
/** topDiffs는 |실제 − 예상| 내림차순 최대 5개 */
export type PlanVsActual = Schemas['PlanVsActual']

export const STATS_QUERY_KEY = ['stats'] as const

export const statsApi = {
  get: (from: string, to: string) => api.request<Stats>(`/api/worklog/stats?from=${from}&to=${to}`),
  planVsActual: (from: string, to: string) =>
    api.request<PlanVsActual>(`/api/worklog/stats/plan-vs-actual?from=${from}&to=${to}`),
}

export function useStats(from: string, to: string) {
  return useQuery({ queryKey: [...STATS_QUERY_KEY, from, to], queryFn: () => statsApi.get(from, to) })
}

/** 시간 기록이 켜져 있을 때만 부른다(꺼져 있으면 영역을 숨긴다) */
export function usePlanVsActual(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: [...STATS_QUERY_KEY, 'plan-vs-actual', from, to],
    queryFn: () => statsApi.planVsActual(from, to),
    enabled,
  })
}

// 통계 API (STAT-01·UX-05, P4-02, SCR-STAT-01). contracts/worklog.yaml 0.6.0의 GET /stats·/stats/plan-vs-actual.
// TODO(P4-02 생성 타입): 0.6.0이 api/generated/worklog에 들어오면 아래 타입을 components['schemas']['Stats'·'PlanVsActual']로 바꾼다.
// 소요시간 비중(⑤)은 기존 GET /records/time-summary를 같은 기간으로 부른다(home/gaps.ts useTimeSummary).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export interface Stats {
  from: string
  to: string
  completedTaskCount: number
  recordCount: number
  confirmedLogCount: number
  /** from부터 to까지 하루도 빠짐없이(0 포함) 날짜순. 주·월 막대는 화면이 묶는다 */
  daily: { date: string; completedTaskCount: number; recordCount: number }[]
  /** 둘 다 0인 프로젝트는 없다. completedTaskCount 내림차순 → recordCount 내림차순 */
  projects: StatsProject[]
  /** 첫 확정 기록 workDate(기간과 무관). "1주일 기록이 쌓이면" 판단은 화면이 한다 */
  firstRecordDate: string | null
}

export interface StatsProject {
  /** 업무 없는 기록·프로젝트 없는 업무는 null */
  projectId: string | null
  completedTaskCount: number
  recordCount: number
}

export interface PlanVsActualWeek {
  /** 주 시작일(기간 앞으로 나갈 수 있음) */
  weekStart: string
  plannedMin: number
  /** 그 주 예상이 있는 업무의 실제 합 */
  actualMin: number
  /** 예상이 없는 업무·업무 없는 기록의 실제 합 */
  unplannedMin: number
}

export interface PlanVsActualTask {
  taskId: string
  title: string
  projectId: string | null
  plannedMin: number
  actualMin: number
}

export interface PlanVsActual {
  from: string
  to: string
  weeks: PlanVsActualWeek[]
  /** |실제 − 예상| 내림차순 최대 5개 */
  topDiffs: PlanVsActualTask[]
}

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

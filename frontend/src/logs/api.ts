// 업무일지 API (P3, contracts/worklog.yaml logs — D-107·D-108).
// 타입은 생성 타입(springdoc 스냅샷). 내보내기(P3-10)는 파일로 받는다(api.download).
// 쿼리 키는 모두 ['logs', …]로 시작한다. 기록·업무가 바뀌면 일지 미리보기도 바뀌므로 함께 무효화한다.
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'

type Schemas = components['schemas']
export type WorkLog = Schemas['WorkLog']
export type LogContent = Schemas['LogContent']
export type LogAchievement = Schemas['LogAchievement']
export type LogPlan = Schemas['LogPlan']
export type PlanCandidate = Schemas['PlanCandidate']
export type LogRevision = Schemas['LogRevision']
export type LogRevisionDetail = Schemas['LogRevisionDetail']
export type WorkLogPatch = Schemas['WorkLogPatch']
export type LogType = WorkLog['type']
export type LogStatus = WorkLog['status']

export type LogPeriod = Schemas['LogPeriod']
export type LogPeriodList = Schemas['LogPeriodList']
export type CarryOverCandidate = Schemas['CarryOverCandidate']
export type LogSuggestion = Schemas['LogSuggestion']
export type DailyClosePlan = Schemas['DailyClosePlan']
export type DailyCloseRequest = Schemas['DailyCloseRequest']
export type DailyCloseResult = Schemas['DailyCloseResult']
export type ExportFormat = 'PDF' | 'DOCX' | 'XLSX'

/** 화면 경로의 소문자 종류 (/logs/daily/:date) */
export const LOG_PATH: Record<LogType, string> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }
export const LOG_TYPE_OF: Record<string, LogType | undefined> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
}

/** 화면 경로. 월간은 /logs/monthly/2026-10 */
export function logHref(type: LogType, periodStart: string): string {
  return `/logs/${LOG_PATH[type]}/${type === 'MONTHLY' ? periodStart.slice(0, 7) : periodStart}`
}

export const LOGS_QUERY_KEY = ['logs'] as const
export const logKey = (type: LogType, periodStart: string) => ['logs', 'one', type, periodStart] as const
export const logPeriodsKey = (type: LogType, from: string, to: string) => ['logs', 'periods', type, from, to] as const

const base = '/api/worklog/logs'

export const logApi = {
  periods: (type: LogType, from: string, to: string) =>
    api.request<LogPeriodList>(`${base}?type=${type}&from=${from}&to=${to}`),
  get: (type: LogType, periodStart: string) => api.request<WorkLog>(`${base}/${LOG_PATH[type]}/${periodStart}`),
  create: (type: LogType, periodStart: string) =>
    api.request<WorkLog>(`${base}/${LOG_PATH[type]}/${periodStart}`, { method: 'POST' }),
  patch: (id: string, body: WorkLogPatch) => api.request<WorkLog>(`${base}/${id}`, { method: 'PATCH', body }),
  refill: (id: string, version: number) =>
    api.request<WorkLog>(`${base}/${id}/refill`, { method: 'POST', body: { version } }),
  confirm: (id: string, version: number) =>
    api.request<WorkLog>(`${base}/${id}/confirm`, { method: 'POST', body: { version } }),
  unconfirm: (id: string, version: number) =>
    api.request<WorkLog>(`${base}/${id}/unconfirm`, { method: 'POST', body: { version } }),
  revisions: (id: string) => api.request<Schemas['LogRevisionList']>(`${base}/${id}/revisions`),
  revision: (id: string, no: number) => api.request<LogRevisionDetail>(`${base}/${id}/revisions/${no}`),
  /** 이 기간 확정 기록 (SCR-LOG-02 ④) */
  records: (from: string, to: string) =>
    api.request<Schemas['WorkRecordList']>(`/api/worklog/records?from=${from}&to=${to}&status=CONFIRMED`),
  closePlan: (date: string) => api.request<DailyClosePlan>(`${base}/daily/${date}/close`),
  close: (date: string, body: DailyCloseRequest) =>
    api.request<DailyCloseResult>(`${base}/daily/${date}/close`, { method: 'POST', body }),
  /** 일지 파일 (SCR-LOG-05, EXP-02~04). 이메일 인증 전이면 403 EMAIL_NOT_VERIFIED */
  exportLog: (type: LogType, periodStart: string, format: ExportFormat) =>
    api.download(`${base}/${LOG_PATH[type]}/${periodStart}/export?format=${format}`),
  /** 기간 업무 기록 Excel (SCR-LOG-05 ②, EXP-03) */
  exportRecords: (from: string, to: string) => api.download(`/api/worklog/records/export?from=${from}&to=${to}`),
}

export function useLog(type: LogType, periodStart: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: logKey(type, periodStart),
    queryFn: () => logApi.get(type, periodStart),
    enabled: options.enabled ?? true,
  })
}

export function useLogPeriods(type: LogType, from: string, to: string) {
  return useQuery({ queryKey: logPeriodsKey(type, from, to), queryFn: () => logApi.periods(type, from, to) })
}

/** 일지·목록 모두 다시 받는다(확정·해제·마감·기록 변경 뒤) */
export function refreshLogs(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: LOGS_QUERY_KEY })
}

/** 받은 일지를 캐시에 바로 넣고 목록은 다시 받는다 */
export function storeLog(queryClient: QueryClient, log: WorkLog) {
  queryClient.setQueryData(logKey(log.type, log.periodStart), log)
  void queryClient.invalidateQueries({ queryKey: ['logs', 'periods'] })
}

/** 업무 요일 비트마스크(월=1 … 일=64)와 공휴일로 근무일인지 */
export function isWorkday(date: string, workDays: number, holiday: string | undefined): boolean {
  if (holiday) return false
  const iso = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
  return (workDays & (1 << (iso - 1))) !== 0
}

const OUTCOME_LABEL = { DONE: '완료', REVIEW_REQUESTED: '검토 요청' } as const

/** 서식 명세 1.6 진행률 칸 */
export function progressLabel(a: Pick<LogAchievement, 'outcome' | 'progress'>): string {
  if (a.outcome === 'DONE' || a.outcome === 'REVIEW_REQUESTED') return OUTCOME_LABEL[a.outcome]
  if (a.outcome === 'IN_PROGRESS') return a.progress != null ? `${a.progress}%` : '진행 중'
  return ''
}

/** 서식 명세 1.6 소요시간: 1시간 30분 · 45분 · 0분은 — */
export function durationLabel(min: number | null | undefined): string {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}분`
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

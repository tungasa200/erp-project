// 타이머 API (P2-06, TIME-03·10, 계약 contracts/worklog.yaml /timer·/timer/start·/timer/stop, D-101).
// 타이머는 따로 저장하지 않는다: 실행 중 타이머 = endAt 없는 기록(사용자당 1개).
// 쿼리 키를 ['records', …] 아래 두어 기록을 고치면(RecordDialog에서 종료를 넣는 등) 타이머도 함께 다시 받는다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from '../api'
import { ApiError } from '../api/problem'
import type { components } from '../api/generated/worklog'
import { RECORDS_QUERY_KEY, type WorkRecord } from '../records/api'

type Schemas = components['schemas']
export type TimerStart = Schemas['TimerStart']
export type TimerStopped = Schemas['TimerStopped']
export type PlanBlock = Schemas['PlanBlock']

export const TIMER_QUERY_KEY = ['records', 'timer'] as const

export const timerApi = {
  get: () => api.request<Schemas['TimerState']>('/api/worklog/timer'),
  /** 실행 중인 타이머가 있으면 서버가 같은 트랜잭션에서 먼저 정지한다(stopped) */
  start: (body: TimerStart) =>
    api.request<{ running: WorkRecord; stopped: TimerStopped | null }>('/api/worklog/timer/start', {
      method: 'POST',
      body,
    }),
  /** 실행 중인 타이머가 없으면 stopped=null(멱등). next는 이어달리기 제안 */
  stop: () =>
    api.request<{ stopped: TimerStopped | null; next: PlanBlock | null }>('/api/worklog/timer/stop', {
      method: 'POST',
    }),
}

/** 지금 실행 중인 타이머(없으면 null). 옵션이 꺼져 있어도 서버는 답한다 */
export function useRunningTimer(enabled = true) {
  return useQuery({
    queryKey: TIMER_QUERY_KEY,
    queryFn: timerApi.get,
    select: (d) => d.running,
    enabled,
  })
}

/** 시작·정지 후 타이머와 기록 목록(홈 타임라인·일지 미리보기)을 다시 받는다 */
export function useTimerCommands() {
  const queryClient = useQueryClient()
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY }), [queryClient])
  const start = useCallback(
    async (body: TimerStart) => {
      try {
        return await timerApi.start(body)
      } finally {
        refresh()
      }
    },
    [refresh],
  )
  const stop = useCallback(async () => {
    try {
      return await timerApi.stop()
    } finally {
      refresh()
    }
  }, [refresh])
  return { start, stop }
}

/** 정지 결과 안내 문구(D-101: 1분 미만 버림, 24시간 상한) */
export function stoppedMessage(stopped: TimerStopped | null): string {
  if (!stopped) return '이미 멈춘 타이머예요'
  if (stopped.discarded)
    return stopped.record.occurrenceStart
      ? '1분이 안 돼서 시간은 남기지 않았어요. 계획은 확인 대기로 돌아갔어요'
      : '1분이 안 돼서 기록하지 않았어요'
  if (stopped.capped) return '24시간이 넘어 24시간까지만 기록했어요. 실제 시간으로 고쳐 주세요'
  return '기록을 남겼어요'
}

/** 시작이 막힌 까닭(계약 409·404). 모르는 오류면 null(공통 오류 토스트) */
export function startFailedMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.code === 'TIME_TRACKING_DISABLED') return '시간 기록이 꺼져 있어요. 기록 옵션에서 켜 주세요'
  if (error.code === 'ALREADY_RECORDED') return '그 계획은 이미 기록했어요'
  return null
}

/** 토스트·안내 안의 업무명은 한 줄로 줄인다(내용은 500자까지) */
export const clip = (text: string) => (text.length > 30 ? `${text.slice(0, 30)}…` : text)

/** 경과 시간 H:MM:SS(1시간 미만은 M:SS) */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 화면 읽기 프로그램용 경과 시간(초 단위는 빼서 매초 바뀌지 않게) */
export function spokenElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return m === 0 ? '1분 미만' : `${m}분`
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

// worklog 전용 설정(GET /api/worklog/me의 settings, PATCH /api/worklog/me/settings).
// 저장은 useProfileSaver와 같은 방식이다: 한 줄로 세워 보내고(앞 응답의 version으로 다음 저장), 409는 충돌 띠.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { worklogApi } from '../api'
import { ApiError, NetworkError } from '../api/problem'
import type { WorklogMe, WorklogSettings, WorklogSettingsPatch } from '../api/types'
import type { SaveResult } from './useProfileSaver'

export const WORKLOG_ME_QUERY_KEY = ['worklogMe'] as const

export type SettingsPatch = Omit<WorklogSettingsPatch, 'version'>
type Failure = Extract<SaveResult, { ok: false }>
export type SettingsSaveResult = { ok: true; settings: WorklogSettings } | Failure

export function useWorklogMe() {
  return useQuery({
    queryKey: WORKLOG_ME_QUERY_KEY,
    queryFn: () => worklogApi.me(),
    // 다른 곳에서 바뀌는 일이 드물어 화면을 옮길 때마다 다시 받지 않는다
    staleTime: 5 * 60_000,
  })
}

/**
 * 시간 기록 옵션(TIME-09). 켜져 있을 때만 시간 관련 화면 요소(타이머·계획/실제 타임라인·빈 시간 메우기·소요시간 집계)를 그린다.
 * 받기 전과 못 받았을 때는 기본값(꺼짐)으로 본다: 숨겼다가 보이는 쪽이 보였다가 사라지는 쪽보다 덜 거슬린다.
 * 옵션은 화면 표시만 바꾸고 데이터는 그대로 둔다.
 */
export function useTimeTracking(): boolean {
  return useWorklogMe().data?.settings.timeTrackingEnabled ?? false
}

export function useWorklogSettingsSaver() {
  const queryClient = useQueryClient()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [conflict, setConflict] = useState(false)

  const save = useCallback(
    (patch: SettingsPatch): Promise<SettingsSaveResult> => {
      const run = async (): Promise<SettingsSaveResult> => {
        const current = queryClient.getQueryData<WorklogMe>(WORKLOG_ME_QUERY_KEY)
        if (!current) return { ok: false, reason: 'error', me: null }
        try {
          const settings = await worklogApi.updateSettings({ ...patch, version: current.settings.version })
          queryClient.setQueryData<WorklogMe>(WORKLOG_ME_QUERY_KEY, (old) => (old ? { ...old, settings } : old))
          return { ok: true, settings }
        } catch (e) {
          if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
            setConflict(true)
            return { ok: false, reason: 'conflict', me: null }
          }
          if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
            return { ok: false, reason: 'invalid', code: e.problem?.errors?.[0]?.code, me: null }
          }
          if (e instanceof NetworkError) return { ok: false, reason: 'network', me: null }
          return { ok: false, reason: 'error', traceId: e instanceof ApiError ? e.traceId : undefined, me: null }
        }
      }
      const result = queue.current.then(run)
      queue.current = result
      return result
    },
    [queryClient],
  )

  const reload = useCallback(async (): Promise<WorklogSettings | null> => {
    await queryClient.refetchQueries({ queryKey: WORKLOG_ME_QUERY_KEY })
    setConflict(false)
    return queryClient.getQueryData<WorklogMe>(WORKLOG_ME_QUERY_KEY)?.settings ?? null
  }, [queryClient])

  return { save, conflict, reload }
}

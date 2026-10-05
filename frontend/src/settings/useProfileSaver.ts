// SCR-SET-01·02 항목별 자동 저장 (PATCH /api/users/me).
// 저장은 한 줄로 세워 보낸다: 앞 저장의 응답을 받은 뒤 그 version으로 다음 저장을 보낸다(동시에 보내면 409).
// 409 VERSION_CONFLICT는 다른 탭·기기에서 먼저 고친 것이라 충돌 띠를 띄우고 덮어쓰지 않는다(화면정의서 2.5, D-30).
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { authApi, worklogApi } from '../api'
import { ApiError, NetworkError } from '../api/problem'
import type { Me, ProfileUpdateRequest } from '../api/types'
import { ME_QUERY_KEY } from '../auth/session'

export type ProfilePatch = Omit<ProfileUpdateRequest, 'version'>

export type SaveResult =
  | { ok: true; me: Me }
  | { ok: false; reason: 'conflict' | 'invalid' | 'network' | 'error'; code?: string; traceId?: string; me: Me | null }

// worklog 사본에 들어가는 칸. keyboardShortcutsEnabled만 바꿨을 때는 재조회하지 않는다.
const PROFILE_FIELDS = new Set(['name', 'organization', 'position', 'timezone', 'weekStart', 'workDays'])

export function useProfileSaver() {
  const queryClient = useQueryClient()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [conflict, setConflict] = useState(false)

  const save = useCallback(
    (patch: ProfilePatch): Promise<SaveResult> => {
      const cached = () => queryClient.getQueryData<Me | null>(ME_QUERY_KEY) ?? null
      const run = async (): Promise<SaveResult> => {
        const current = cached()
        if (!current) return { ok: false, reason: 'error', me: null }
        try {
          const me = await authApi.updateMe({ ...patch, version: current.version })
          queryClient.setQueryData(ME_QUERY_KEY, me)
          // 실패해도 worklog 사본은 피드로 약 30초 안에 맞춰지므로 기다리지 않고 오류도 알리지 않는다.
          if (Object.keys(patch).some((k) => PROFILE_FIELDS.has(k))) void worklogApi.refreshProfile().catch(() => {})
          return { ok: true, me }
        } catch (e) {
          if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
            setConflict(true)
            return { ok: false, reason: 'conflict', me: cached() }
          }
          if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
            return { ok: false, reason: 'invalid', code: e.problem?.errors?.[0]?.code, me: cached() }
          }
          if (e instanceof NetworkError) return { ok: false, reason: 'network', me: cached() }
          return { ok: false, reason: 'error', traceId: e instanceof ApiError ? e.traceId : undefined, me: cached() }
        }
      }
      const result = queue.current.then(run)
      queue.current = result
      return result
    },
    [queryClient],
  )

  // 새로 받은 값을 돌려준다. 캐시 구독자(useAuth)는 다음 틱에야 갱신되므로 화면은 이 값으로 다시 채운다.
  const reload = useCallback(async (): Promise<Me | null> => {
    await queryClient.refetchQueries({ queryKey: ME_QUERY_KEY })
    setConflict(false)
    return queryClient.getQueryData<Me | null>(ME_QUERY_KEY) ?? null
  }, [queryClient])

  return { save, conflict, reload }
}

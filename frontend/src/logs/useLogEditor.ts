// SCR-LOG-02 초안 편집·자동 저장 (LOG-03·04, D-107).
// 고친 칸만 따로 들고 있다가 잠시 뒤(입력 멈춤) PATCH로 보낸다. 서버 값은 고친 칸이 없는 부분에 그대로 보인다
// (자동 상태 실적은 기록이 바뀌면 함께 바뀐다). 미리보기(id=null)는 처음 고칠 때 초안을 만든 뒤 저장한다.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { logApi, logKey, storeLog, type LogAchievement, type LogPlan, type WorkLog, type WorkLogPatch } from './api'

export interface LogEdits {
  achievements?: LogAchievement[]
  plans?: LogPlan[]
  issues?: string
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

const SAVE_DELAY_MS = 800

export function useLogEditor(log: WorkLog | undefined, callbacks: { onPinned: () => void; onConfirmed: () => void }) {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<LogEdits | null>(null)
  const [state, setState] = useState<SaveState>('idle')
  const editsRef = useRef<LogEdits | null>(null)
  const logRef = useRef(log)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<WorkLog | null> | null>(null)
  const cb = useRef(callbacks)
  useLayoutEffect(() => {
    logRef.current = log
    cb.current = callbacks
  })

  const apply = useCallback((next: LogEdits | null) => {
    editsRef.current = next
    setEdits(next)
  }, [])

  /** 미리보기면 초안을 만들고 그 일지를 준다 */
  const ensureSaved = useCallback(
    async (current: WorkLog): Promise<WorkLog> => {
      if (current.id) return current
      const created = await logApi.create(current.type, current.periodStart)
      storeLog(queryClient, created)
      return created
    },
    [queryClient],
  )

  const flush = useCallback(async (): Promise<WorkLog | null> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // 앞 저장이 끝나야 새 version으로 보낸다
    if (inFlight.current) await inFlight.current
    const sent = editsRef.current
    const current = logRef.current
    if (!sent || !current) return current ?? null
    // 글자가 빈 줄이 있는 칸은 아직 보내지 않는다(계약 text minLength 1). 줄만 추가해서는 고정되지 않게
    const blank = (rows: { text: string }[] | undefined) => !!rows?.some((r) => !r.text.trim())
    const held = blank(sent.achievements) || blank(sent.plans)
    const sendAchievements = sent.achievements && !blank(sent.achievements)
    const sendPlans = sent.plans && !blank(sent.plans)
    if (!sendAchievements && !sendPlans && sent.issues === undefined) return current
    const run = (async () => {
      setState('saving')
      try {
        const saved = await ensureSaved(current)
        const body: WorkLogPatch = { version: saved.version }
        if (sendAchievements) body.achievements = sent.achievements
        if (sendPlans) body.plans = sent.plans
        if (sent.issues !== undefined) body.issues = sent.issues || null
        const next = await logApi.patch(saved.id!, body)
        const pinned = !!sendAchievements && saved.content.achievementsAuto && !next.content.achievementsAuto
        storeLog(queryClient, next)
        // 보낸 뒤 더 고치지 않았고 남겨 둔 빈 줄도 없으면 서버 값으로 돌아간다
        if (editsRef.current === sent && !held) apply(null)
        setState('saved')
        if (pinned) cb.current.onPinned()
        return next
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          if (error.code === 'LOG_CONFIRMED') {
            apply(null)
            cb.current.onConfirmed()
            void queryClient.invalidateQueries({ queryKey: logKey(current.type, current.periodStart) })
            setState('idle')
          } else setState('conflict')
        } else setState('error')
        return null
      }
    })()
    inFlight.current = run
    try {
      return await run
    } finally {
      inFlight.current = null
    }
  }, [apply, ensureSaved, queryClient])

  const change = useCallback(
    (patch: LogEdits) => {
      apply({ ...editsRef.current, ...patch })
      setState((s) => (s === 'conflict' ? s : 'idle'))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        if (logRef.current) void flush()
      }, SAVE_DELAY_MS)
    },
    [apply, flush],
  )

  // 화면을 떠날 때 남은 수정을 보낸다
  // 아직 보내지 않은 수정이 있으면 탭을 닫기 전에 묻는다(자동 저장 0.8초 사이)
  useEffect(() => {
    if (!edits && state !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [edits, state])

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void flush()
      }
    },
    [flush],
  )

  /** 충돌 띠의 "새로 불러오기": 내 수정을 버리고 서버 값으로 */
  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    apply(null)
    setState('idle')
    const current = logRef.current
    if (current) void queryClient.invalidateQueries({ queryKey: logKey(current.type, current.periodStart) })
  }, [apply, queryClient])

  /** 확정·다시 채우기·해제 뒤: 서버가 준 일지를 쓰므로 로컬 수정만 비운다 */
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    apply(null)
    setState('idle')
  }, [apply])

  return { edits, state, change, flush, discard, reset, ensureSaved }
}

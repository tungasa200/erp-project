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

const filled = <T extends { text: string }>(rows: T[]) => rows.filter((r) => r.text.trim())

/** 실적·계획에 글자가 빈 줄이 남아 있는지(확정할 때 "빈 줄은 빼고" 알림) */
export function hasBlankRows(edits: LogEdits | null) {
  const blank = (rows: { text: string }[] | undefined) => !!rows?.some((r) => !r.text.trim())
  return !!edits && (blank(edits.achievements) || blank(edits.plans))
}

/** 빈 줄을 뺀 목록이 서버 목록과 다르면 보낼 목록을, 같으면 undefined */
function changedList<T extends { text: string }>(edited: T[] | undefined, server: T[]): T[] | undefined {
  if (!edited) return undefined
  const rows = filled(edited)
  return JSON.stringify(rows) === JSON.stringify(server) ? undefined : rows
}

export function useLogEditor(log: WorkLog | undefined, callbacks: { onPinned: () => void; onConfirmed: () => void }) {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<LogEdits | null>(null)
  const [state, setState] = useState<SaveState>('idle')
  const editsRef = useRef<LogEdits | null>(null)
  const logRef = useRef(log)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<WorkLog | null> | null>(null)
  const cb = useRef(callbacks)
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    logRef.current = log
    cb.current = callbacks
    stateRef.current = state
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
    // 글자가 빈 줄은 서버로 보내지 않고 편집 상태에만 둔다(계약 text minLength 1). 나머지 줄은 그대로 보낸다(UX-LOG-140:
    // 빈 줄 하나 때문에 목록 전체를 보류하면 그 사이 지운 줄이 확정 문서에 되살아난다). 빈 줄을 빼면 서버 목록과 같을 때는
    // 보내지 않는다(줄만 추가해서는 자동 실적이 고정되지 않게)
    const held = hasBlankRows(sent)
    const sendAchievements = changedList(sent.achievements, current.content.achievements)
    const sendPlans = changedList(sent.plans, current.content.plans)
    if (!sendAchievements && !sendPlans && sent.issues === undefined) return current
    const run = (async () => {
      setState('saving')
      try {
        const saved = await ensureSaved(current)
        const body: WorkLogPatch = { version: saved.version }
        if (sendAchievements) body.achievements = sendAchievements
        if (sendPlans) body.plans = sendPlans
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

  // 오프라인이 되기 직전의 수정은 보내지 못하고 남는다. 다시 연결되면 바로 보낸다(UX-LOG-40, 조용히 사라지지 않게).
  // 충돌 상태는 사용자가 고를 때까지 보내지 않는다
  useEffect(() => {
    const retry = () => {
      if (editsRef.current && !timer.current && stateRef.current !== 'conflict') void flush()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [flush])

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

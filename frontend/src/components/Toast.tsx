// 오류 알림 토스트 (화면정의서 2.5: 저장·통신 오류는 토스트, 5xx는 문의 코드와 복사 버튼)와
// 되돌리기 토스트(SCR-COM-04: 5초 노출, 마우스를 올리거나 포커스가 있으면 유지, Ctrl+Z로 복원, 연속 동작은 하나로 누적).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isEditable } from '../shortcuts/useShortcuts'
import { CopyCodeButton } from './CopyCodeButton'
import styles from './Toast.module.css'
import { ToastContext, type ToastValue, type UndoOptions } from './useToast'

interface ToastItem {
  id: number
  message: string
  traceId?: string
}

interface UndoItem {
  id: number
  group: string
  count: number
  message: UndoOptions['message']
  undos: UndoOptions['undo'][]
  commits: NonNullable<UndoOptions['commit']>[]
}

const DURATION_MS = 5000

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [undoItem, setUndoItem] = useState<UndoItem | null>(null)
  const [paused, setPaused] = useState(false)
  const nextId = useRef(1)
  const undoRef = useRef<UndoItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const deadline = useRef(0)
  const remaining = useRef(DURATION_MS)
  const pauseReasons = useRef(new Set<string>())

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const showToast = useCallback<ToastValue['showToast']>(
    (message, options) => {
      const id = nextId.current++
      setItems((list) => [...list, { id, message, traceId: options?.traceId }])
      // 문의 코드가 있으면 복사할 시간을 주기 위해 자동으로 닫지 않는다.
      if (!options?.traceId) setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss],
  )

  const setUndo = useCallback((item: UndoItem | null) => {
    undoRef.current = item
    setUndoItem(item)
  }, [])

  const clearUndo = useCallback(() => {
    clearTimeout(timer.current)
    pauseReasons.current.clear()
    setPaused(false)
    setUndo(null)
  }, [setUndo])

  // 되돌리지 않고 닫으면 미뤄 둔 동작을 확정한다.
  const closeUndo = useCallback(() => {
    const item = undoRef.current
    clearUndo()
    item?.commits.forEach((commit) => commit({ keepalive: false }))
  }, [clearUndo])

  const startTimer = useCallback(
    (ms: number) => {
      clearTimeout(timer.current)
      deadline.current = Date.now() + ms
      timer.current = setTimeout(closeUndo, ms)
    },
    [closeUndo],
  )

  const showUndo = useCallback<ToastValue['showUndo']>(
    ({ group, message, undo, commit }) => {
      const current = undoRef.current
      const commits = commit ? [commit] : []
      if (current && current.group === group) {
        setUndo({
          ...current,
          count: current.count + 1,
          message,
          undos: [...current.undos, undo],
          commits: [...current.commits, ...commits],
        })
      } else {
        // 다른 동작의 토스트로 바뀌면 앞 동작은 더 되돌릴 수 없으니 확정한다.
        current?.commits.forEach((c) => c({ keepalive: false }))
        setUndo({ id: nextId.current++, group, count: 1, message, undos: [undo], commits })
      }
      remaining.current = DURATION_MS
      if (pauseReasons.current.size === 0) startTimer(DURATION_MS)
    },
    [setUndo, startTimer],
  )

  const runUndo = useCallback(async () => {
    const item = undoRef.current
    if (!item) return
    clearUndo()
    try {
      // 나중에 한 동작부터 되돌린다.
      for (const undo of [...item.undos].reverse()) await undo()
    } catch {
      showToast('되돌리지 못했어요. 잠시 후 다시 시도해 주세요')
    }
  }, [clearUndo, showToast])

  const pause = (reason: string) => {
    if (pauseReasons.current.size === 0) {
      clearTimeout(timer.current)
      remaining.current = Math.max(0, deadline.current - Date.now())
      setPaused(true)
    }
    pauseReasons.current.add(reason)
  }

  const resume = (reason: string) => {
    if (!pauseReasons.current.delete(reason) || pauseReasons.current.size > 0) return
    setPaused(false)
    startTimer(remaining.current)
  }

  // 페이지를 떠나거나 숨기면 미뤄 둔 동작을 바로 확정한다(사용자 결정 P1-02-07). 토스트도 함께 치워 같은 동작이
  // 두 번 나가지 않게 한다. 모바일 브라우저는 탭을 닫을 때 pagehide를 주지 않기도 해 visibilitychange도 본다.
  useEffect(() => {
    const flush = () => {
      const item = undoRef.current
      if (!item?.commits.length) return
      clearUndo()
      item.commits.forEach((commit) => commit({ keepalive: true }))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [clearUndo])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ') return
      // 입력창 안의 Ctrl+Z는 글자 되돌리기로 남겨 둔다.
      if (!undoRef.current || isEditable(e.target)) return
      e.preventDefault()
      void runUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runUndo])

  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(() => ({ showToast, showUndo }), [showToast, showUndo])

  return (
    <ToastContext value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={styles.toast}>
            <span className={styles.message}>{t.message}</span>
            {t.traceId && <CopyCodeButton code={t.traceId} inverted />}
            <button type="button" className={styles.close} aria-label="닫기" onClick={() => dismiss(t.id)}>
              <CloseIcon />
            </button>
          </div>
        ))}
        {undoItem && (
          <div
            className={paused ? `${styles.toast} ${styles.undo} ${styles.paused}` : `${styles.toast} ${styles.undo}`}
            onMouseEnter={() => pause('hover')}
            onMouseLeave={() => resume('hover')}
            onFocus={() => pause('focus')}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) resume('focus')
            }}
          >
            <span className={styles.message}>{undoItem.message(undoItem.count)}</span>
            <button type="button" className={styles.undoButton} onClick={() => void runUndo()}>
              되돌리기
            </button>
            <button type="button" className={styles.close} aria-label="닫기" onClick={closeUndo}>
              <CloseIcon />
            </button>
            {/* 합쳐질 때마다 key가 바뀌어 남은 시간 막대를 처음부터 다시 그린다 */}
            <span key={`${undoItem.id}-${undoItem.count}`} className={styles.progress} aria-hidden="true" />
          </div>
        )}
      </div>
    </ToastContext>
  )
}

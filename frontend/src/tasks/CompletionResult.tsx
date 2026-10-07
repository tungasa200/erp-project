// SCR-TASK-03 완료 결과 입력 (P2-02, REC-02). 업무를 완료한 순간 결과를 한 줄로 남긴다 — 3초 안에 끝나는 것이 목표.
// 완료한 행은 목록에서 빠지므로 행에 붙이지 않고 화면 아래(되돌리기 토스트 반대편)에 띄우는 비모달 팝오버다.
// Enter: 결과·칩으로 확정 기록을 만든다 / 건너뛰기·Esc·바깥 누르기: 결과 없이 "완료"로 기록한다.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toastForError } from '../api/errorToast'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { todayIn } from '../quickInput/dates'
import { RECORDS_QUERY_KEY, recordApi, type WorkRecord, type WorkRecordOutcome } from '../records/api'
import type { Task } from './api'
import styles from './CompletionResult.module.css'
import { CompletionResultContext, type OpenCompletionResult } from './completionResultContext'

interface Entry {
  key: number
  task: Task
  workDate: string
  returnFocus: () => void
  /** 닫혔으면 true (저장했든 건너뛰었든 되돌렸든) */
  closed: boolean
  /** 보낸 기록 요청. 실패했으면 null로 끝난다 */
  record: Promise<WorkRecord | null> | null
}

interface Choice {
  result: string
  outcome: WorkRecordOutcome
  progress: number
}

const OUTCOMES: { value: WorkRecordOutcome; label: string }[] = [
  { value: 'DONE', label: '완료' },
  { value: 'REVIEW_REQUESTED', label: '검토 요청' },
  { value: 'IN_PROGRESS', label: '진행 중' },
]

export function CompletionResultHost({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [entry, setEntry] = useState<Entry | null>(null)
  const entryRef = useRef<Entry | null>(null)
  const nextKey = useRef(1)

  const send = useCallback(
    (e: Entry, choice: Choice, keepalive = false) =>
      recordApi.create(
        {
          content: e.task.title,
          taskId: e.task.id,
          workDate: e.workDate,
          result: choice.result.trim() || null,
          outcome: choice.outcome,
          // progress는 진행 중일 때만 (계약: 다른 결과에 보내면 INVALID_FORMAT)
          progress: choice.outcome === 'IN_PROGRESS' ? choice.progress : null,
        },
        { keepalive },
      ),
    [],
  )

  /** 팝오버를 닫는다. 포커스가 팝오버 안(또는 BODY)에 있었으면 돌려준다 */
  const close = useCallback((e: Entry) => {
    if (e.closed) return
    e.closed = true
    const active = document.activeElement
    const hadFocus = !active || active === document.body || Boolean(active.closest('[data-completion-result]'))
    if (entryRef.current === e) {
      entryRef.current = null
      setEntry(null)
    }
    if (hadFocus) e.returnFocus()
  }, [])

  /** 결과 없이 "완료"로 기록하고 닫는다. 요청은 뒤에서 보내고, 실패하면 토스트로 알린다 */
  const skip = useCallback(
    (e: Entry, options: { restoreFocus: boolean } = { restoreFocus: true }) => {
      if (e.closed) return
      e.record = send(e, { result: '', outcome: 'DONE', progress: 0 })
        .then((record) => {
          void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY })
          return record
        })
        .catch((error: unknown) => {
          const { message, traceId } = toastForError(error)
          showToast(`완료 기록을 남기지 못했어요. ${message}`, { traceId })
          return null
        })
      if (options.restoreFocus) close(e)
      else {
        e.closed = true
        if (entryRef.current === e) entryRef.current = null
      }
    },
    [close, queryClient, send, showToast],
  )

  // 팝오버를 연 채 새로고침·탭 닫기를 하면 건너뛰기와 같게 결과 없이 "완료"로 기록한다(업무만 완료되고 기록이 빠지지 않게).
  // 페이지가 내려가는 중이라 keepalive로 보낸다
  useEffect(() => {
    const onPageHide = () => {
      const e = entryRef.current
      if (!e || e.closed) return
      e.closed = true
      entryRef.current = null
      // 뒤로 가기 캐시(bfcache)로 돌아왔을 때 이미 기록한 팝오버가 남아 두 번 기록되지 않게 닫아 둔다
      setEntry(null)
      void send(e, { result: '', outcome: 'DONE', progress: 0 }, true).catch(() => null)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [send])

  const open = useCallback<OpenCompletionResult>(
    (task, returnFocus) => {
      // 앞 업무의 팝오버가 열려 있으면 결과 없이 기록하고 바꾼다(포커스는 새 팝오버로 간다)
      if (entryRef.current) skip(entryRef.current, { restoreFocus: false })
      const e: Entry = {
        key: nextKey.current++,
        task,
        workDate: todayIn(timeZone),
        returnFocus,
        closed: false,
        record: null,
      }
      entryRef.current = e
      setEntry(e)
      return {
        revoke: async () => {
          close(e)
          const record = await e.record
          if (!record) return
          await recordApi.remove(record.id)
          void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY })
        },
      }
    },
    [close, queryClient, skip, timeZone],
  )

  const submit = async (e: Entry, choice: Choice): Promise<string | null> => {
    const request = send(e, choice)
    e.record = request.catch(() => null)
    try {
      await request
      void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY })
      close(e)
      return null
    } catch (error) {
      e.record = null
      return toastForError(error).message
    }
  }

  return (
    <CompletionResultContext.Provider value={open}>
      {children}
      {entry && (
        <ResultPopover
          key={entry.key}
          task={entry.task}
          onSubmit={(choice) => submit(entry, choice)}
          onSkip={() => skip(entry)}
        />
      )}
    </CompletionResultContext.Provider>
  )
}

function ResultPopover({
  task,
  onSubmit,
  onSkip,
}: {
  task: Task
  /** 실패하면 알릴 문구 */
  onSubmit: (choice: Choice) => Promise<string | null>
  onSkip: () => void
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState('')
  const [outcome, setOutcome] = useState<WorkRecordOutcome>('DONE')
  // 진행 중 칩의 진행률: 업무의 진행률에서 시작한다(10 단위, 진행 중이라 0~90%)
  const [progress, setProgress] = useState(() => Math.min(90, Math.round(task.progress / 10) * 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 바깥을 누르면 결과 없이 기록하고 닫는다(누른 곳의 동작은 그대로 일어난다)
  const skipRef = useRef(onSkip)
  const savingRef = useRef(saving)
  useEffect(() => {
    skipRef.current = onSkip
    savingRef.current = saving
  })
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!savingRef.current && !ref.current?.contains(e.target as Node)) skipRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    const failed = await onSubmit({ result, outcome, progress })
    if (failed) {
      setSaving(false)
      setError(`저장하지 못했어요. ${failed}`)
      inputRef.current?.focus()
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      data-completion-result=""
      className={styles.popover}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) {
          e.stopPropagation()
          onSkip()
        }
      }}
    >
      <form onSubmit={(e) => void save(e)} className={styles.form}>
        <p id={`${id}-title`} className={styles.title}>
          <span className={styles.done} aria-hidden="true">
            ✓
          </span>
          <span className={styles.taskTitle} title={task.title}>
            {task.title}
          </span>
          <span className={styles.srOnly}> 완료 — 결과 남기기</span>
        </p>
        <label htmlFor={`${id}-result`} className={styles.srOnly}>
          결과 한 줄
        </label>
        <input
          ref={inputRef}
          id={`${id}-result`}
          className={styles.input}
          placeholder="결과 한 줄 (예: 초안 공유, 금요일에 확정)"
          maxLength={200}
          autoComplete="off"
          value={result}
          readOnly={saving}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${id}-error` : undefined}
          onChange={(e) => setResult(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter는 글자 확정이지 저장이 아니다
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
          }}
        />
        <fieldset className={styles.chips} disabled={saving}>
          <legend className={styles.srOnly}>결과</legend>
          {OUTCOMES.map((o) => (
            <label key={o.value} className={styles.chip}>
              <input
                type="radio"
                name={`${id}-outcome`}
                value={o.value}
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
              />
              <span>{o.value === 'IN_PROGRESS' ? `${o.label} ${progress}%` : o.label}</span>
            </label>
          ))}
        </fieldset>
        {outcome === 'IN_PROGRESS' && (
          <label className={styles.progress}>
            <span>진행률</span>
            <input
              type="range"
              min={0}
              max={90}
              step={10}
              value={progress}
              disabled={saving}
              aria-valuetext={`${progress}%`}
              onChange={(e) => setProgress(Number(e.target.value))}
            />
          </label>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <span id={`${id}-hint`} className={styles.hint}>
            Enter 저장 · Esc 건너뛰기
          </span>
          <button type="button" className={styles.skip} disabled={saving} onClick={onSkip}>
            건너뛰기
          </button>
          <button type="submit" className={styles.save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}

// 타이머 시작·업무 전환 창 (SCR-COM-06 ④ 업무 전환, TIME-03). 업무를 고르거나 할 일을 적어 시작한다.
// 실행 중인 타이머가 있으면 서버가 먼저 정지한다(동시 1개). 명령 팔레트의 "타이머 시작"도 이 창을 연다.
import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../api/problem'
import { Modal } from '../calendar/Modal'
import { TaskLinkField } from '../calendar/TaskLinkField'
import calendar from '../calendar/calendar.module.css'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { toastForError } from '../api/errorToast'
import { clip, startFailedMessage, stoppedMessage, useTimerCommands } from './api'

interface Props {
  /** 실행 중인 타이머가 있으면 그 이름(전환 안내) */
  runningName?: string
  /** started: 새 타이머를 시작했으면 true */
  onClose: (started: boolean) => void
}

export function TimerStartDialog({ runningName, onClose }: Props) {
  const id = useId()
  const online = useOnline()
  const { start } = useTimerCommands()
  const { showToast } = useToast()
  const [content, setContent] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !online) return
    if (!taskId && !content.trim()) return setError('업무를 고르거나 할 일을 적어 주세요')
    setBusy(true)
    try {
      const { running, stopped } = await start({ taskId, content: content.trim() || null })
      const before = stopped ? `${stoppedMessage(stopped)} · ` : ''
      showToast(`${before}‘${clip(running.content)}’ 타이머를 시작했어요`)
      onClose(true)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.status === 404)
        return setError('고른 업무를 찾지 못했어요. 보관됐을 수 있어요')
      const known = startFailedMessage(err)
      if (known) return setError(known)
      const { message, traceId } = toastForError(err)
      showToast(message, { traceId })
    }
  }

  return (
    <Modal labelledBy={`${id}-title`} narrow onClose={() => onClose(false)}>
      <div className={calendar.dialogHead}>
        <h2 id={`${id}-title`}>{runningName ? '다른 업무로 전환' : '타이머 시작'}</h2>
        <button type="button" className={calendar.close} aria-label="닫기" onClick={() => onClose(false)}>
          ×
        </button>
      </div>
      <form className={calendar.fieldset} onSubmit={(e) => void submit(e)} noValidate>
        {runningName && <p className={calendar.muted}>‘{clip(runningName)}’ 타이머는 멈추고 기록으로 남겨요</p>}
        {!online && (
          <p className={calendar.muted} role="status">
            연결이 끊겼어요. 다시 연결되면 시작할 수 있어요
          </p>
        )}
        <fieldset className={calendar.fieldset} disabled={!online}>
          <TaskLinkField
            taskId={taskId}
            onChange={(next) => {
              setTaskId(next)
              setError('')
            }}
            recurring={false}
          />
          <label className={calendar.field}>
            할 일 {taskId && <span className={calendar.muted}>(비우면 업무 제목)</span>}
            <input
              className={calendar.input}
              maxLength={500}
              autoComplete="off"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setError('')
              }}
              {...(error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {})}
            />
          </label>
          {error && (
            <p id={`${id}-error`} role="alert" className={calendar.fieldError}>
              {error}
            </p>
          )}
        </fieldset>
        <div className={calendar.actions}>
          <span className={calendar.grow} />
          <button type="button" className={calendar.secondary} onClick={() => onClose(false)}>
            취소
          </button>
          <button type="submit" className={calendar.primary} disabled={busy || !online}>
            {busy ? '시작 중…' : runningName ? '전환' : '시작'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// SCR-COM-06 타이머 미니 플레이어 (TIME-03·10, P2-06, D-101). 사이드바 하단 / 모바일 하단 탭 위에 앱 셸이 단다.
// ① 업무명 ② 경과 시간 ③ 정지 ④ 업무 전환. 시간 기록 옵션이 켜져 있고 타이머가 돌 때만 보인다.
// 경과 시간은 서버의 startAt 기준이라 브라우저를 닫았다 열어도 이어진다. 정지하면 서버가 기록을 끝내고
// 1분 미만은 버리고 24시간이 넘으면 자른다(discarded·capped를 알린다). 이어달리기 제안(next)이 있으면
// 플레이어 자리에 "다음 계획을 시작할까요?"를 남긴다.
import { useEffect, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { focusPageHeading } from '../components/focusFallback'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { RecordDialog } from '../records/RecordDialog'
import { useTimeTracking } from '../settings/useWorklogSettings'
import {
  clip,
  formatElapsed,
  spokenElapsed,
  startFailedMessage,
  stoppedMessage,
  useRunningTimer,
  useTimerCommands,
  type PlanBlock,
} from './api'
import { TimerStartDialog } from './TimerStartDialog'
import styles from './TimerMiniPlayer.module.css'

const DAY_MS = 24 * 60 * 60 * 1000

/** 정지 뒤 플레이어 자리에 남기는 안내 */
interface AfterStop {
  message: string
  next: PlanBlock | null
  /** 24시간에서 잘린 기록(고치기 버튼) */
  cappedId: string | null
}

export function TimerMiniPlayer() {
  const timed = useTimeTracking()
  const timer = useRunningTimer(timed)
  const running = timed ? (timer.data ?? null) : null
  const online = useOnline()
  const { start, stop } = useTimerCommands()
  const { showToast } = useToast()
  // 매초 넘기는 지금 시각. 타이머가 없던 동안 멈춰 있어 막 시작하면 1초 안쪽은 0:00으로 보인다(formatElapsed가 음수를 0으로)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [after, setAfter] = useState<AfterStop | null>(null)
  const [switching, setSwitching] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const afterRef = useRef<HTMLDivElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  // 이어달리기로 시작하면 새 타이머의 정지 버튼으로 포커스를 옮긴다
  const focusStop = useRef(false)

  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [running])

  useEffect(() => {
    if (after) afterRef.current?.querySelector('button')?.focus()
  }, [after])

  const runningId = running?.id
  useEffect(() => {
    if (focusStop.current && runningId) {
      stopRef.current?.focus()
      focusStop.current = false
    }
  }, [runningId])

  const failed = (error: unknown) => {
    const known = startFailedMessage(error)
    if (known) return showToast(known)
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const onStop = async () => {
    if (busy || !online) return
    setBusy(true)
    try {
      const { stopped, next } = await stop()
      const cappedId = stopped?.capped ? stopped.record.id : null
      if (next || cappedId) setAfter({ message: stoppedMessage(stopped), next, cappedId })
      else {
        setAfter(null)
        showToast(stoppedMessage(stopped))
        // 플레이어가 사라지므로 포커스를 화면 제목으로(P1-07-18)
        focusPageHeading()
      }
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => {
    setAfter(null)
    focusPageHeading()
  }

  const relay = async (next: PlanBlock) => {
    if (busy || !online) return
    setBusy(true)
    try {
      const { running: started } = await start({ scheduleId: next.scheduleId, occurrenceStart: next.occurrenceStart })
      showToast(`‘${clip(started.content)}’ 타이머를 시작했어요`)
      focusStop.current = true
      setAfter(null)
    } catch (error) {
      // 이미 기록했거나(409) 회차가 사라졌으면(404) 제안을 거둔다
      if (error instanceof ApiError && (error.code === 'ALREADY_RECORDED' || error.status === 404)) {
        setAfter((a) => (a ? { ...a, next: null } : a))
        showToast(error.status === 404 ? '그 계획이 바뀌었거나 취소됐어요' : '그 계획은 이미 기록했어요')
      } else failed(error)
    } finally {
      setBusy(false)
    }
  }

  const elapsed = running?.startAt ? now - Date.parse(running.startAt) : 0

  return (
    <div className={styles.slot}>
      {running ? (
        <section className={styles.player} aria-label={`타이머: ${running.content}`}>
          <p className={styles.name} title={running.content}>
            {running.content}
          </p>
          <p className={styles.elapsed}>
            <span aria-hidden="true">{formatElapsed(elapsed)}</span>
            <span className={styles.srOnly}>{spokenElapsed(elapsed)} 지남</span>
          </p>
          {elapsed >= DAY_MS && <p className={styles.note}>24시간이 넘었어요. 멈추면 24시간까지만 기록돼요</p>}
          {!online && <p className={styles.note}>연결되면 멈추거나 바꿀 수 있어요</p>}
          <div className={styles.actions}>
            <button
              ref={stopRef}
              type="button"
              className={styles.stop}
              disabled={busy || !online}
              onClick={() => void onStop()}
            >
              정지
            </button>
            <button
              type="button"
              className={`${styles.switch} ${styles.narrowHide}`}
              disabled={busy || !online}
              onClick={() => setSwitching(true)}
            >
              업무 전환
            </button>
          </div>
        </section>
      ) : (
        timed &&
        after && (
          <section ref={afterRef} className={styles.player} aria-label="타이머">
            <p className={styles.message} role="status">
              {after.message}
            </p>
            {after.next && <p className={styles.relay}>다음 계획 ‘{clip(after.next.title)}’을(를) 시작할까요?</p>}
            <div className={styles.actions}>
              {after.next && (
                <button
                  type="button"
                  className={styles.stop}
                  disabled={busy || !online}
                  onClick={() => void relay(after.next!)}
                >
                  시작
                </button>
              )}
              {after.cappedId && (
                <button type="button" className={styles.switch} onClick={() => setEditing(after.cappedId)}>
                  시간 고치기
                </button>
              )}
              <button type="button" className={styles.switch} onClick={dismiss}>
                {after.next ? '괜찮아요' : '닫기'}
              </button>
            </div>
          </section>
        )
      )}
      {switching && running && <TimerStartDialog runningName={running.content} onClose={() => setSwitching(false)} />}
      {editing && (
        <RecordDialog
          recordId={editing}
          onClose={(changed) => {
            setEditing(null)
            if (changed) setAfter((a) => (a ? { ...a, cappedId: null } : a))
          }}
        />
      )}
    </div>
  )
}

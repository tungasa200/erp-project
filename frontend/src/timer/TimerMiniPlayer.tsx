// SCR-COM-06 타이머 미니 플레이어 (TIME-03·10, P2-06, D-101). 사이드바 하단 / 모바일 하단 탭 위에 앱 셸이 단다.
// ① 업무명 ② 경과 시간 ③ 정지 ④ 업무 전환(태블릿 좁은 사이드바에서는 둘 다 44×44 아이콘 버튼). 시간 기록 옵션이 켜져 있고 타이머가 돌 때만 보인다.
// 경과 시간은 서버의 startAt 기준이라 브라우저를 닫았다 열어도 이어진다. 정지하면 서버가 기록을 끝내고
// 1분 미만은 버리고 24시간이 넘으면 자른다(discarded·capped를 알린다). 이어달리기 제안(next)이 있으면
// 플레이어 자리에 "다음 계획을 시작할까요?"를 남긴다.
import { useEffect, useId, useRef, useState } from 'react'
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
  const afterRef = useRef<HTMLElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  // 이어달리기로 시작하면 새 타이머의 정지 버튼으로 포커스를 옮긴다
  const focusStop = useRef(false)
  const offlineId = useId()

  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [running])

  // 정지 응답이 먼저 오고 타이머 조회가 뒤에 비워지므로, 안내가 실제로 나타난 뒤 첫 버튼(시작·시간 고치기)으로 옮긴다
  const afterShown = !running && !!after
  useEffect(() => {
    if (afterShown) afterRef.current?.querySelector('button')?.focus()
  }, [after, afterShown])

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
      const result = await stop()
      const { stopped } = result
      // 이어달리기는 기록을 남긴 뒤에만 제안한다(1분 미만이라 버렸으면 제안하지 않는다)
      const next = stopped?.discarded ? null : result.next
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
          {!online && (
            <p id={offlineId} className={styles.offline}>
              <span className={styles.wide}>연결되면 멈추거나 바꿀 수 있어요</span>
              {/* 좁은 사이드바에서는 긴 안내가 들어가지 않아 짧게 보인다(버튼은 aria-describedby로 긴 안내를 읽는다) */}
              <span className={styles.narrowOnly} aria-hidden="true">
                연결 끊김
              </span>
            </p>
          )}
          <div className={styles.actions}>
            <button
              ref={stopRef}
              type="button"
              className={styles.stop}
              disabled={busy || !online}
              aria-describedby={online ? undefined : offlineId}
              title={online ? undefined : '연결되면 멈출 수 있어요'}
              aria-label="타이머 정지"
              onClick={() => void onStop()}
            >
              <span className={styles.wide}>정지</span>
              <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.switch}
              disabled={busy || !online}
              aria-describedby={online ? undefined : offlineId}
              title={online ? undefined : '연결되면 바꿀 수 있어요'}
              aria-label="업무 전환"
              onClick={() => setSwitching(true)}
            >
              <span className={styles.wide}>업무 전환</span>
              <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
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
          capped
          onClose={(changed) => {
            setEditing(null)
            if (changed) setAfter((a) => (a ? { ...a, cappedId: null } : a))
          }}
        />
      )}
    </div>
  )
}

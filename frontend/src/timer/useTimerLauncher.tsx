// 정해 둔 대상으로 타이머 시작(P2-06 진입점: 캘린더 일정 상세, 업무 목록 줄 메뉴 — 사용자 결정 2026-10-07).
// 실행 중인 타이머가 없으면 바로 시작하고, 있으면 TimerStartDialog로 "전환할까요?"를 묻는다(서버가 앞 타이머를 정지).
// 시간 기록 옵션이 꺼져 있으면 available=false — 진입점 버튼을 그리지 않는다.
import { useEffect, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { useTimeTracking } from '../settings/useWorklogSettings'
import {
  clip,
  notFoundMessage,
  startFailedMessage,
  stoppedMessage,
  useRunningTimer,
  useTimerCommands,
  type TimerPreset,
} from './api'
import { TimerStartDialog } from './TimerStartDialog'

/** onStarted: 새 타이머를 시작했을 때(진입점의 모달을 닫는 등) */
export function useTimerLauncher(onStarted?: () => void) {
  const available = useTimeTracking()
  const running = useRunningTimer(available).data ?? null
  const { start } = useTimerCommands()
  const { showToast } = useToast()
  const [confirm, setConfirm] = useState<TimerPreset | null>(null)
  const [busy, setBusy] = useState(false)
  // 확인 창에서 시작했으면 그 창이 먼저 닫힌(포커스를 진입점 버튼으로 돌린) 다음 커밋에서 알린다.
  // 같은 커밋에 진입점 모달까지 닫으면 확인 창이 사라진 버튼으로 포커스를 돌리려다 화면 제목으로 빠진다
  const startedViaDialog = useRef(false)
  const onStartedRef = useRef(onStarted)
  useEffect(() => {
    onStartedRef.current = onStarted
  })
  useEffect(() => {
    if (confirm || !startedViaDialog.current) return
    startedViaDialog.current = false
    onStartedRef.current?.()
  }, [confirm])

  const launch = async (preset: TimerPreset) => {
    if (busy) return
    const { scheduleId, occurrenceStart } = preset.body
    if (running && scheduleId && running.scheduleId === scheduleId && running.occurrenceStart === occurrenceStart)
      return showToast('이 일정의 타이머가 이미 돌고 있어요')
    if (running) return setConfirm(preset)
    setBusy(true)
    try {
      // 실행 중 타이머를 아직 못 받았으면 서버가 앞 타이머를 멈추고 stopped로 알려 준다
      const { running: started, stopped } = await start(preset.body)
      const before = stopped ? `${stoppedMessage(stopped)} · ` : ''
      showToast(`${before}‘${clip(started.content)}’ 타이머를 시작했어요`)
      onStarted?.()
    } catch (error) {
      const known =
        error instanceof ApiError && error.status === 404 ? notFoundMessage(preset.body) : startFailedMessage(error)
      if (known) showToast(known)
      else {
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
    } finally {
      setBusy(false)
    }
  }

  const dialog = confirm && (
    <TimerStartDialog
      preset={confirm}
      runningName={running?.content}
      onClose={(started) => {
        setConfirm(null)
        startedViaDialog.current = started
      }}
    />
  )

  return { available, busy, launch, dialog }
}

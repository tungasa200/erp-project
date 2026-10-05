// 코드 입력 단계 (SCR-AUTH-05 ②, SCR-AUTH-08 ②~④). 코드 확인·다시 받기 API는 화면마다 달라 함수로 받는다.
// 틀리면 "코드가 맞지 않아요(남은 시도 n회)", 5회를 다 틀렸거나 10분이 지나면 입력을 잠그고 "새 코드 받기"만 남긴다.
import { useState } from 'react'
import { toastForError } from '../api/errorToast'
import { codeFailure, sendLimitMessage, timesOf, type CodeIssued, type CodeTimes } from './api'
import { CodeInput } from './CodeInput'
import { mmss, useCountdown } from './useCountdown'
import styles from './verification.module.css'

interface Props {
  initial: CodeTimes
  check: (code: string) => Promise<void>
  resend: () => Promise<CodeIssued>
  onVerified: (code: string) => void
  /** 이미 확인을 마쳐 입력을 닫아 둘 때 */
  verified?: boolean
  autoFocus?: boolean
}

export function CodeStep({ initial, check, resend, onVerified, verified = false, autoFocus }: Props) {
  const [code, setCode] = useState('')
  const [times, setTimes] = useState(initial)
  const [expired, setExpired] = useState(initial.expiresAt === null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const left = useCountdown(times.expiresAt ?? null)
  const resendLeft = useCountdown(times.resendAt ?? null) ?? 0
  const locked = expired || left === 0

  const submit = async (value: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await check(value)
      onVerified(value)
    } catch (error) {
      const failure = codeFailure(error)
      setCode('')
      if (failure.kind === 'mismatch') setMessage(`코드가 맞지 않아요 (남은 시도 ${failure.attemptsRemaining}회)`)
      else if (failure.kind === 'expired') {
        setExpired(true)
        setMessage('이 코드는 더 쓸 수 없어요. 새 코드를 받아 주세요')
      } else setMessage(toastForError(failure.error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendAgain = async () => {
    setBusy(true)
    try {
      setTimes(timesOf(await resend()))
      setExpired(false)
      setCode('')
      setMessage('새 코드를 보냈어요')
    } catch (error) {
      const limited = sendLimitMessage(error)
      if (limited) {
        setMessage(limited.message)
        if (limited.retryAt) setTimes((t) => ({ ...t, resendAt: limited.retryAt }))
      } else setMessage(toastForError(error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.step}>
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(value) => void submit(value)}
        disabled={verified || locked || busy}
        status={verified ? 'ok' : message?.startsWith('코드가 맞지') ? 'error' : 'idle'}
        describedBy="code-step-message"
        autoFocus={autoFocus}
      />
      <p id="code-step-message" role="status" className={styles.message}>
        {verified ? <span className={styles.ok}>✓ 확인됐어요</span> : message}
      </p>
      {!verified && (
        <div className={styles.timerRow}>
          <span className={styles.timer}>
            {locked ? '코드를 새로 받아 주세요' : left !== null ? `남은 시간 ${mmss(left)}` : ''}
          </span>
          <button
            type="button"
            className={locked ? styles.resendStrong : styles.resend}
            disabled={busy || resendLeft > 0}
            onClick={() => void sendAgain()}
          >
            {locked ? '새 코드 받기' : '다시 받기'}
            {resendLeft > 0 && ` · ${resendLeft}초`}
          </button>
        </div>
      )}
    </div>
  )
}

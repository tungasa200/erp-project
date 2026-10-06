// 코드 입력 단계 (SCR-AUTH-05 ②, SCR-AUTH-08 ②~④). 코드 확인·다시 받기 API는 화면마다 달라 함수로 받는다.
// 틀리면 "코드가 맞지 않아요(남은 시도 n회)", 5회를 다 틀렸거나 10분이 지나면 입력을 잠그고 "새 코드 받기"만 남긴다.
import { useEffect, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { useAuth } from '../auth/useAuth'
import { codeFailure, sendLimitMessage, timesOf, type CodeIssued, type CodeTimes } from './api'
import { CodeInput } from './CodeInput'
import { mmss, useCountdown } from './useCountdown'

/** AUTH-08: 코드는 10분간 유효, 다시 받기는 60초 간격 */
const CODE_VALID_SECONDS = 600
const RESEND_INTERVAL_SECONDS = 60
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
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [times, setTimes] = useState(initial)
  const [expired, setExpired] = useState(initial.expiresAt === null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 화면에 보이는 남은 시간은 규칙(AUTH-08: 코드 10분, 다시 받기 60초)보다 길 수 없다
  const left = useCountdown(times.expiresAt ?? null, CODE_VALID_SECONDS)
  const resendLeft = useCountdown(times.resendAt ?? null, RESEND_INTERVAL_SECONDS) ?? 0
  const locked = expired || left === 0

  // 확인·다시 받기 중에는 코드 칸·버튼이 잠겨 포커스가 BODY로 빠진다. 끝나면 코드 칸(잠겼으면 이 단계)으로 돌려준다.
  // 확인에 성공하면 이 단계 밖(재설정의 새 비밀번호 칸 등)이 이어서 옮긴다
  const inputRef = useRef<HTMLInputElement>(null)
  const stepRef = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current || busy) return
    refocus.current = false
    const input = inputRef.current
    if (input && !input.disabled) input.focus()
    else if (!stepRef.current?.contains(document.activeElement)) stepRef.current?.focus()
  }, [busy, locked, verified])

  const submit = async (value: string) => {
    refocus.current = true
    setBusy(true)
    setMessage(null)
    try {
      await check(value)
      onVerified(value)
    } catch (error) {
      const failure = codeFailure(error)
      setCode('')
      if (failure.kind === 'mismatch') setMessage(`코드가 맞지 않아요(남은 시도 ${failure.attemptsRemaining}회)`)
      else if (failure.kind === 'expired') {
        setExpired(true)
        setMessage('이 코드는 더 쓸 수 없어요. 새 코드를 받아 주세요')
      } else setMessage(toastForError(failure.error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendAgain = async () => {
    refocus.current = true
    setBusy(true)
    try {
      setTimes(timesOf(await resend()))
      setExpired(false)
      setCode('')
      setMessage('새 코드를 보냈어요')
    } catch (error) {
      // 로그인 전(비밀번호 재설정)이면 user가 없어 브라우저 시간대로 보인다
      const limited = sendLimitMessage(error, user?.timezone)
      if (limited) {
        setMessage(limited.message)
        if (limited.retryAt) setTimes((t) => ({ ...t, resendAt: limited.retryAt }))
      } else setMessage(toastForError(error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={stepRef} tabIndex={-1} className={styles.step}>
      <CodeInput
        inputRef={inputRef}
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
            // 코드가 잠긴 채로 열리면(만료·시도 초과) 코드 칸 대신 이 버튼으로 포커스
            autoFocus={autoFocus && locked}
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

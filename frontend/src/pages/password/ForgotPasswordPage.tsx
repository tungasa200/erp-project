// SCR-AUTH-04 비밀번호 찾기. 가입 여부와 관계없이 코드 입력 단계(SCR-AUTH-05)로 넘어간다(계정 존재 비노출).
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toastForError } from '../../api/errorToast'
import { EMAIL_PATTERN } from '../../auth/passwordRules'
import { passwordResetApi, sendLimitMessage, timesOf, type CodeTimes } from '../../verification/api'
import { PasswordLayout } from './PasswordLayout'
import styles from './password.module.css'

/** 재설정 화면으로 넘기는 값 */
export interface ResetState {
  email: string
  times: CodeTimes
}

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!EMAIL_PATTERN.test(value)) {
      setError(value ? '이메일 형식이 올바르지 않아요' : '이메일을 입력해 주세요')
      return
    }
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const issued = await passwordResetApi.request(value)
      navigate('/password/reset', { state: { email: value, times: timesOf(issued) } satisfies ResetState })
    } catch (err) {
      const limited = sendLimitMessage(err)
      if (limited?.code === 'RESEND_TOO_SOON') {
        // 60초 안에 다시 누른 경우: 앞서 보낸 코드를 그대로 쓰면 되므로 입력 단계로 넘긴다.
        const times: CodeTimes = { expiresAt: undefined, resendAt: limited.retryAt }
        navigate('/password/reset', { state: { email: value, times } satisfies ResetState })
      } else setNotice(limited ? limited.message : toastForError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PasswordLayout>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <span className={styles.icon} aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
          </svg>
        </span>
        <h1 className={styles.title}>비밀번호 찾기</h1>
        <p className={styles.lead}>가입한 이메일로 6자리 인증번호를 보내드려요.</p>
        <div className={styles.field}>
          <label htmlFor="forgot-email" className={styles.label}>
            이메일
          </label>
          <input
            id="forgot-email"
            type="email"
            className={styles.input}
            placeholder="name@company.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? 'forgot-email-error' : undefined}
          />
          {error && (
            <p id="forgot-email-error" className={styles.fieldError}>
              {error}
            </p>
          )}
        </div>
        <button type="submit" className={styles.submit} disabled={busy}>
          인증번호 받기
        </button>
        {notice && (
          <p role="alert" className={styles.warning}>
            {notice}
          </p>
        )}
        <Link to="/login" className={styles.back}>
          로그인으로 돌아가기
        </Link>
      </form>
    </PasswordLayout>
  )
}

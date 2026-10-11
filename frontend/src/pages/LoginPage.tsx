// SCR-AUTH-02 로그인
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import type { LoginLocationState } from '../app/guards'
import { useAuth } from '../auth/useAuth'
import { EMAIL_PATTERN } from '../auth/passwordRules'
import { useToast } from '../components/useToast'
import { AuthLayout } from './auth/AuthLayout'
import styles from './auth/auth.module.css'

type Notice = { kind: 'invalid'; slowed: boolean } | { kind: 'locked' | 'throttled'; until: number }

// 서버는 연속 실패 3회부터 응답을 1초 이상 늦춘다(AUTH-09 점진 지연). 그만큼 늦게 온 실패 응답이면 지연 중으로 본다.
const SLOWED_MS = 900

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function LoginPage() {
  const { login } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? {}) as LoginLocationState

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [withdrawnShown, setWithdrawnShown] = useState(state.reason === 'withdrawn')

  // 탈퇴 완료 띠는 새로 고치면 사라지게(SET-07s ④) 기록의 state에서 이유를 지운다. 띠는 위 state로 이미 잡아 둠
  useEffect(() => {
    const kept = (location.state ?? {}) as LoginLocationState
    if (kept.reason === 'withdrawn') void navigate('.', { replace: true, state: { ...kept, reason: undefined } })
  }, [location, navigate])

  const waitUntil = notice && notice.kind !== 'invalid' ? notice.until : 0
  const waiting = waitUntil > now

  useEffect(() => {
    if (!waitUntil) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waitUntil])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting || waiting) return
    const next: typeof errors = {}
    if (!email.trim()) next.email = '입력해 주세요'
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = '이메일 형식이 맞지 않아요'
    if (!password) next.password = '입력해 주세요'
    setErrors(next)
    if (next.email || next.password) return

    setSubmitting(true)
    setNotice(null)
    const startedAt = performance.now()
    try {
      await login({ email: email.trim(), password })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setNotice({ kind: 'invalid', slowed: performance.now() - startedAt >= SLOWED_MS })
      } else if (error instanceof ApiError && error.status === 429) {
        const seconds = error.problem?.retryAfterSeconds ?? 60
        setNow(Date.now())
        setNotice({ kind: error.code === 'AUTH_LOCKED' ? 'locked' : 'throttled', until: Date.now() + seconds * 1000 })
      } else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const codes = new Map(error.problem?.errors?.map((x) => [x.field, x.code]))
        const message = (field: string, otherwise: string) =>
          codes.has(field) ? (codes.get(field) === 'REQUIRED' ? '입력해 주세요' : otherwise) : undefined
        setErrors({
          email: message('email', '이메일 형식이 맞지 않아요'),
          password: message('password', '입력해 주세요'),
        })
      } else {
        const toast = toastForError(error)
        showToast(toast.message, { traceId: toast.traceId })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      heading={
        <>
          따로 기록하지 않아도
          <br />
          일지가 써지는 도구
        </>
      }
      description="계획 → 확인 → 일지. 퇴근 전 1분이면 충분해요."
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>로그인</h1>

        {state.reason === 'expired' && !notice && (
          <div role="status" className={`${styles.alert} ${styles.alertInfo}`}>
            다시 로그인해 주세요. 로그인 후 보던 화면으로 돌아가요.
          </div>
        )}
        {state.reason === 'passwordChanged' && !notice && (
          <div role="status" className={`${styles.alert} ${styles.alertInfo}`}>
            비밀번호를 바꿨어요. 새 비밀번호로 다시 로그인해 주세요.
          </div>
        )}
        {/* SCR-SET-07 ④ 탈퇴 완료. 닫기 전까지 남는다(로그인 실패 안내와 함께 보일 수 있음) */}
        {withdrawnShown && (
          <div role="status" className={`${styles.alert} ${styles.alertDone}`}>
            <span className={styles.alertBody}>회원 탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.</span>
            <button
              type="button"
              className={styles.alertClose}
              aria-label="안내 닫기"
              onClick={() => {
                setWithdrawnShown(false)
                document.getElementById('login-email')?.focus()
              }}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
        {state.reason === 'deleted' && !notice && (
          <div role="status" className={`${styles.alert} ${styles.alertInfo}`}>
            <span>
              탈퇴 처리된 계정입니다. 같은 이메일로 다시 가입할 수 있습니다. <Link to="/signup">회원가입</Link>
            </span>
          </div>
        )}
        {notice?.kind === 'invalid' && (
          <div role="alert" className={`${styles.alert} ${styles.alertDanger}`}>
            <span className={styles.alertMark}>!</span>
            <span>
              이메일 또는 비밀번호가 맞지 않아요
              {notice.slowed && (
                <>
                  <br />
                  잠시 후 다시 시도해 주세요
                </>
              )}
            </span>
          </div>
        )}
        {notice?.kind === 'locked' && waiting && (
          <div role="alert" className={`${styles.alert} ${styles.alertDanger}`}>
            <span className={styles.alertMark}>!</span>
            <span>
              <b>15분 동안 로그인할 수 없어요.</b>
              <br />
              비밀번호를 10번 잘못 입력했어요. 비밀번호가 기억나지 않으면{' '}
              <Link to="/password/forgot">재설정하세요</Link>.
            </span>
          </div>
        )}
        {notice?.kind === 'throttled' && waiting && (
          <div role="alert" className={`${styles.alert} ${styles.alertWarning}`}>
            <span className={styles.alertMark}>!</span>
            <span>잠시 후 다시 시도해 주세요</span>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-email">
            이메일
          </label>
          <input
            id="login-email"
            className={styles.input}
            type="email"
            autoComplete="username"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
          {errors.email && (
            <p id="login-email-error" className={styles.fieldError}>
              {errors.email}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-password">
            비밀번호
          </label>
          <span className={styles.inputGroup}>
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                {showPassword && <path d="M4 4l16 16" />}
              </svg>
            </button>
          </span>
          {errors.password && (
            <p id="login-password-error" className={styles.fieldError}>
              {errors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          className={styles.submit}
          // 보내는 중·잠김에는 disabled 대신 aria-disabled로 막는다. disabled면 누른 버튼에서 포커스가 BODY로 빠진다
          aria-disabled={submitting || waiting}
          aria-busy={submitting}
        >
          {waiting ? `로그인 · ${formatRemaining(waitUntil - now)} 후 가능` : submitting ? '로그인 중…' : '로그인'}
        </button>

        <div className={styles.links}>
          <Link to="/password/forgot">비밀번호 찾기</Link>
          <Link to="/signup">회원가입</Link>
        </div>
      </form>
    </AuthLayout>
  )
}

// SCR-AUTH-05 비밀번호 재설정. 코드가 맞으면 새 비밀번호 칸을 연다. 저장하면 서버가 이메일 인증을 마치고
// 모든 기기의 로그인을 끊으므로(쿠키도 지움) 로그인 화면으로 보낸다.
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toastForError } from '../../api/errorToast'
import { ApiError } from '../../api/problem'
import { passwordViolations, type PasswordRuleCode } from '../../auth/passwordRules'
import { useToast } from '../../components/useToast'
import { codeFailure, passwordResetApi, type CodeTimes } from '../../verification/api'
import { CodeStep } from '../../verification/CodeStep'
import type { ResetState } from './ForgotPasswordPage'
import { PasswordLayout } from './PasswordLayout'
import styles from './password.module.css'

const RULES: { code: PasswordRuleCode; label: string }[] = [
  { code: 'PASSWORD_LENGTH', label: '8~64자' },
  { code: 'PASSWORD_LETTER_DIGIT_REQUIRED', label: '영문·숫자 포함' },
  { code: 'PASSWORD_SAME_AS_EMAIL', label: '이메일과 다른 문자열' },
]
const TOO_LONG = '비밀번호가 너무 길어요. 한글은 한 글자가 더 많은 자리를 차지해요.'

export function ResetPasswordPage() {
  const state = useLocation().state as ResetState | null
  // 비밀번호 찾기를 거치지 않고 들어오면(새로 고침 후 상태가 없을 때 포함) 처음 단계로
  if (!state?.email) return <Navigate to="/password/forgot" replace />
  return <ResetForm email={state.email} times={state.times} />
}

function ResetForm({ email, times }: { email: string; times: CodeTimes }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [code, setCode] = useState<string | null>(null) // 확인된 코드
  // 저장 중 코드가 만료되면 코드 단계를 잠근 채 다시 그린다
  const [codeStep, setCodeStep] = useState({ key: 0, times })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  // 코드를 확인하면 코드 칸이 잠기므로 새 비밀번호 칸으로 포커스를 옮긴다 (SCR-AUTH-05)
  useEffect(() => {
    if (code) document.getElementById('reset-password')?.focus()
  }, [code])

  const violations = passwordViolations(password, email)
  const tooLong = violations.includes('PASSWORD_TOO_LONG_BYTES')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code || busy) return
    const next: typeof errors = {}
    if (tooLong) next.password = TOO_LONG
    else if (violations.length) next.password = '비밀번호 규칙을 확인해 주세요.'
    if (!next.password && confirm !== password) next.confirm = '비밀번호가 일치하지 않아요'
    setErrors(next)
    if (next.password || next.confirm) return

    setBusy(true)
    try {
      await passwordResetApi.confirm(email, code, password)
      showToast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요')
      navigate('/login', { replace: true })
    } catch (err) {
      const failure = codeFailure(err)
      if (failure.kind !== 'other') {
        setCode(null)
        setCodeStep((s) => ({ key: s.key + 1, times: { expiresAt: null, resendAt: null } }))
        setErrors({ form: '코드를 다시 확인해야 해요. 새 코드를 받아 주세요' })
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const codes = err.problem?.errors?.filter((x) => x.field === 'newPassword').map((x) => x.code) ?? []
        setErrors({ password: codes.includes('PASSWORD_TOO_LONG_BYTES') ? TOO_LONG : '비밀번호 규칙을 확인해 주세요.' })
      } else setErrors({ form: toastForError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PasswordLayout>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <h1 className={styles.title}>비밀번호 재설정</h1>
        <p className={styles.lead}>
          <b className={styles.email}>{email}</b>으로 보낸 6자리 숫자를 입력하세요.
        </p>

        <CodeStep
          key={codeStep.key}
          initial={codeStep.times}
          verified={code !== null}
          autoFocus
          check={(value) => passwordResetApi.verify(email, value)}
          resend={() => passwordResetApi.request(email)}
          onVerified={setCode}
        />

        <fieldset className={styles.passwordFields} disabled={code === null}>
          <div className={styles.field}>
            <label htmlFor="reset-password" className={styles.label}>
              새 비밀번호
            </label>
            <input
              id="reset-password"
              type="password"
              className={styles.input}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={errors.password || tooLong ? true : undefined}
              aria-describedby="reset-password-rules reset-password-error"
            />
          </div>
          <ul id="reset-password-rules" className={styles.rules} aria-label="비밀번호 규칙">
            {RULES.map((rule) => {
              const ok = password !== '' && !violations.includes(rule.code)
              return (
                <li key={rule.code} className={ok ? styles.ruleOk : styles.ruleIdle}>
                  {ok ? '✓' : '○'} {rule.label}
                  <span className={styles.srOnly}>{ok ? ' 충족' : ' 미충족'}</span>
                </li>
              )
            })}
          </ul>
          {(errors.password || tooLong) && (
            <p id="reset-password-error" className={styles.fieldError}>
              {tooLong ? TOO_LONG : errors.password}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor="reset-password-confirm" className={styles.label}>
              새 비밀번호 확인
            </label>
            <input
              id="reset-password-confirm"
              type="password"
              className={styles.input}
              autoComplete="new-password"
              placeholder="한 번 더 입력"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? 'reset-confirm-error' : undefined}
            />
            {errors.confirm && (
              <p id="reset-confirm-error" className={styles.fieldError}>
                {errors.confirm}
              </p>
            )}
          </div>
        </fieldset>

        <p className={styles.warning}>
          저장하면 이메일 인증도 함께 완료되고, <b>모든 기기에서 로그아웃</b>돼요.
        </p>
        {errors.form && (
          <p role="alert" className={styles.formError}>
            {errors.form}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={code === null} aria-disabled={busy} aria-busy={busy}>
          저장하고 다시 로그인
        </button>
      </form>
    </PasswordLayout>
  )
}

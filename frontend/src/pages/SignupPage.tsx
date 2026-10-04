// SCR-AUTH-03 회원가입. 말투는 "~합니다" (D-36)
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { EMAIL_PATTERN, passwordViolations, type PasswordRuleCode } from '../auth/passwordRules'
import { useToast } from '../components/useToast'
import { AuthLayout } from './auth/AuthLayout'
import styles from './auth/auth.module.css'

type Field = 'email' | 'password' | 'passwordConfirm' | 'agreements'
type Errors = Partial<Record<Field, string>>

const RULES: { code: PasswordRuleCode; label: string }[] = [
  { code: 'PASSWORD_LENGTH', label: '8~64자' },
  { code: 'PASSWORD_LETTER_DIGIT_REQUIRED', label: '영문·숫자 포함' },
  { code: 'PASSWORD_SAME_AS_EMAIL', label: '이메일과 다른 문자열' },
]

const MESSAGES = {
  EMAIL_INVALID: '이메일 형식이 올바르지 않습니다.',
  EMAIL_ALREADY_EXISTS: '이미 가입된 이메일입니다.',
  PASSWORD_RULES: '비밀번호 규칙을 확인해 주십시오.',
  PASSWORD_TOO_LONG_BYTES: '비밀번호가 너무 깁니다. 한글은 한 글자가 영문보다 많은 자리를 차지합니다.',
  PASSWORD_MISMATCH: '비밀번호가 일치하지 않습니다.',
  AGREEMENT_REQUIRED: '필수 항목에 모두 동의해야 가입할 수 있습니다.',
  REQUIRED: '필수 입력 항목입니다.',
}

function passwordMessage(codes: string[]): string | undefined {
  if (codes.includes('PASSWORD_TOO_LONG_BYTES')) return MESSAGES.PASSWORD_TOO_LONG_BYTES
  if (codes.length) return MESSAGES.PASSWORD_RULES
  return undefined
}

// 서버 errors[]를 화면의 칸에 붙인다. 화면에 없는 칸의 오류는 따로 돌려준다 (화면정의서 2.5).
function mapServerErrors(list: { field: string; code: string }[]): { errors: Errors; unknown: boolean } {
  const errors: Errors = {}
  let unknown = false
  const passwordCodes: string[] = []
  for (const { field, code } of list) {
    if (field === 'email') errors.email = code === 'EMAIL_INVALID' ? MESSAGES.EMAIL_INVALID : MESSAGES.REQUIRED
    else if (field === 'password') passwordCodes.push(code)
    else if (field === 'agreeTerms' || field === 'agreePrivacy') errors.agreements = MESSAGES.AGREEMENT_REQUIRED
    else unknown = true
  }
  errors.password = passwordMessage(passwordCodes)
  return { errors, unknown }
}

export function SignupPage() {
  const { signup } = useAuth()
  const { showToast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [emailTaken, setEmailTaken] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const violations = passwordViolations(password, email)
  // 72바이트 초과는 입력하는 동안 바로 알린다 (한글 약 24자)
  const tooLong = violations.includes('PASSWORD_TOO_LONG_BYTES')
  const passwordError = tooLong ? MESSAGES.PASSWORD_TOO_LONG_BYTES : errors.password

  const ruleClass = (code: PasswordRuleCode) => {
    if (!password) return submitted ? styles.ruleBad : styles.ruleIdle
    if (!violations.includes(code)) return styles.ruleOk
    return submitted ? styles.ruleBad : styles.ruleIdle
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setEmailTaken(false)
    const next: Errors = {}
    if (!EMAIL_PATTERN.test(email.trim())) next.email = email.trim() ? MESSAGES.EMAIL_INVALID : MESSAGES.REQUIRED
    next.password = password ? passwordMessage(violations) : MESSAGES.REQUIRED
    if (password && passwordConfirm !== password) next.passwordConfirm = MESSAGES.PASSWORD_MISMATCH
    if (!agreeTerms || !agreePrivacy) next.agreements = MESSAGES.AGREEMENT_REQUIRED
    setErrors(next)
    if (Object.values(next).some(Boolean)) return

    setSubmitting(true)
    try {
      await signup({ email: email.trim(), password, agreeTerms, agreePrivacy })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_EXISTS') {
        setErrors({ email: MESSAGES.EMAIL_ALREADY_EXISTS })
        setEmailTaken(true)
      } else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const mapped = mapServerErrors(error.problem?.errors ?? [])
        setErrors(mapped.errors)
        if (mapped.unknown) showToast('입력 내용을 다시 확인해 주세요', { traceId: error.traceId })
      } else {
        const toast = toastForError(error)
        showToast(toast.message, { traceId: toast.traceId })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const allAgreed = agreeTerms && agreePrivacy

  return (
    <AuthLayout
      heading={
        <>
          이메일과 비밀번호로
          <br />
          가입할 수 있습니다
        </>
      }
      description="이름·소속 등 추가 정보는 첫 업무일지 작성 시 입력합니다."
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>회원가입</h1>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="signup-email">
            이메일
          </label>
          <input
            id="signup-email"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'signup-email-error' : undefined}
          />
          {errors.email && (
            <p id="signup-email-error" className={styles.fieldError}>
              {errors.email}
              {emailTaken && (
                <>
                  {' '}
                  <Link to="/login">로그인하기</Link>
                </>
              )}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="signup-password">
            비밀번호
          </label>
          <input
            id="signup-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? 'signup-password-rules signup-password-error' : 'signup-password-rules'}
          />
        </div>
        <ul id="signup-password-rules" className={styles.rules} aria-label="비밀번호 규칙">
          {RULES.map((rule) => {
            const ok = password !== '' && !violations.includes(rule.code)
            return (
              <li key={rule.code} className={ruleClass(rule.code)}>
                {ok ? '✓' : '○'} {rule.label}
                <span className="visually-hidden">{ok ? ' 충족' : ' 미충족'}</span>
              </li>
            )
          })}
        </ul>
        {passwordError && (
          <p id="signup-password-error" className={`${styles.fieldError} ${styles.tight}`}>
            {passwordError}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="signup-password-confirm">
            비밀번호 확인
          </label>
          <input
            id="signup-password-confirm"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="비밀번호 재입력"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            aria-invalid={errors.passwordConfirm ? true : undefined}
            aria-describedby={errors.passwordConfirm ? 'signup-password-confirm-error' : undefined}
          />
          {errors.passwordConfirm && (
            <p id="signup-password-confirm-error" className={styles.fieldError}>
              {errors.passwordConfirm}
            </p>
          )}
        </div>

        <fieldset
          className={styles.agreements}
          aria-describedby={errors.agreements ? 'signup-agreements-error' : undefined}
        >
          <legend className="visually-hidden">약관 동의</legend>
          <label className={`${styles.check} ${styles.checkAll}`}>
            <input
              type="checkbox"
              checked={allAgreed}
              onChange={(e) => {
                setAgreeTerms(e.target.checked)
                setAgreePrivacy(e.target.checked)
              }}
            />
            전체 동의
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
            <span className={styles.checkText}>[필수] 이용약관 동의</span>
            <Link className={styles.checkLink} to="/terms" target="_blank">
              내용 보기
            </Link>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
            <span className={styles.checkText}>[필수] 개인정보 수집·이용 동의</span>
            <Link className={styles.checkLink} to="/privacy" target="_blank">
              내용 보기
            </Link>
          </label>
          <p className={styles.overseas}>
            회원 정보와 서비스 이용 기록은 싱가포르 소재 서버(Railway)에 보관되며, 메일 발송 등 일부 업무는 국외 업체에
            위탁하여 처리합니다.{' '}
            <Link to="/privacy#overseas" target="_blank">
              자세히 보기
            </Link>
          </p>
        </fieldset>
        {errors.agreements && (
          <p id="signup-agreements-error" className={`${styles.fieldError} ${styles.tight}`}>
            {errors.agreements}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={submitting} aria-busy={submitting}>
          {submitting ? '가입 중…' : '회원가입'}
        </button>
        <p className={styles.note}>
          가입 후 입력한 이메일로 인증번호가 발송됩니다. 이메일 인증은 업무일지를 내보내기 전까지 완료해야 합니다.
        </p>
        <p className={styles.center}>
          이미 계정이 있으신 경우{' '}
          <Link className={styles.strong} to="/login">
            로그인
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}

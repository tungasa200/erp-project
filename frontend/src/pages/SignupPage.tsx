// SCR-AUTH-03 회원가입. 말투는 "~합니다" (D-36)
// 가입은 인증 뒤 계정 생성(D-220): 폼을 내면 코드만 받고, 같은 화면의 코드 단계에서 맞히면 계정이 생기고 로그인된다(GuestOnly가 홈으로)
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import type { SignupRequest } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { EMAIL_PATTERN, passwordViolations, type PasswordRuleCode } from '../auth/passwordRules'
import { useToast } from '../components/useToast'
import { sendLimitMessage, timesOf, type CodeTimes } from '../verification/api'
import { CodeStep } from '../verification/CodeStep'
import { AuthLayout } from './auth/AuthLayout'
import { useFocusFirstError } from './auth/useFocusFirstError'
import styles from './auth/auth.module.css'
import codeStyles from './password/password.module.css'

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
  const { signup, confirmSignup } = useAuth()
  const { showToast } = useToast()
  // 코드 단계. body는 다시 받기에 그대로 쓴다(같은 요청, 계약 0.4.0)
  const [codeStep, setCodeStep] = useState<{ body: SignupRequest; times: CodeTimes } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  // 만 14세 확인은 화면에서만(D-172 ①). 가입 요청에는 보내지 않는다 — 서버 기록은 REL 법률 검토 때
  const [agreeAge, setAgreeAge] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [emailTaken, setEmailTaken] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { ref: formRef, focusFirstError } = useFocusFirstError<HTMLFormElement>()

  // [이메일 고치기]로 폼에 돌아오면 이메일 칸으로(누른 버튼이 사라지므로). 오류가 있으면 focusFirstError가 옮긴다
  const backToForm = useRef(false)
  useEffect(() => {
    if (codeStep || !backToForm.current) return
    backToForm.current = false
    if (!formRef.current?.querySelector('[aria-invalid="true"]')) document.getElementById('signup-email')?.focus()
  }, [codeStep, formRef])
  const editEmail = () => {
    backToForm.current = true
    setCodeStep(null)
  }

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
    if (submitting) return
    setSubmitted(true)
    setEmailTaken(false)
    setNotice(null)
    const next: Errors = {}
    if (!EMAIL_PATTERN.test(email.trim())) next.email = email.trim() ? MESSAGES.EMAIL_INVALID : MESSAGES.REQUIRED
    next.password = password ? passwordMessage(violations) : MESSAGES.REQUIRED
    if (password && passwordConfirm !== password) next.passwordConfirm = MESSAGES.PASSWORD_MISMATCH
    if (!agreeAge || !agreeTerms || !agreePrivacy) next.agreements = MESSAGES.AGREEMENT_REQUIRED
    setErrors(next)
    if (Object.values(next).some(Boolean)) {
      focusFirstError()
      return
    }

    setSubmitting(true)
    const body: SignupRequest = { email: email.trim(), password, agreeTerms, agreePrivacy }
    try {
      setCodeStep({ body, times: timesOf(await signup(body)) })
    } catch (error) {
      const limited = sendLimitMessage(error)
      if (limited?.code === 'RESEND_TOO_SOON') {
        // 60초 안에 다시 낸 경우: 앞서 보낸 코드를 그대로 쓰면 되므로 코드 단계로 넘긴다(비밀번호 찾기와 같음)
        setCodeStep({ body, times: { expiresAt: undefined, resendAt: limited.retryAt } })
      } else if (limited) setNotice(limited.message)
      else if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_EXISTS') {
        setErrors({ email: MESSAGES.EMAIL_ALREADY_EXISTS })
        setEmailTaken(true)
        focusFirstError()
      } else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const mapped = mapServerErrors(error.problem?.errors ?? [])
        setErrors(mapped.errors)
        focusFirstError()
        if (mapped.unknown) showToast('입력 내용을 다시 확인해 주세요', { traceId: error.traceId })
      } else {
        const toast = toastForError(error)
        showToast(toast.message, { traceId: toast.traceId })
      }
    } finally {
      setSubmitting(false)
    }
  }

  // 코드를 기다리는 사이 같은 이메일로 가입이 끝난 경우(다른 탭 등): 폼으로 돌아가 로그인을 안내한다
  const alreadyJoined = (error: unknown): never => {
    if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_EXISTS') {
      setErrors({ email: MESSAGES.EMAIL_ALREADY_EXISTS })
      setEmailTaken(true)
      setCodeStep(null)
      focusFirstError()
    }
    throw error
  }

  if (codeStep) {
    const { body } = codeStep
    return (
      <AuthLayout heading="이메일 인증을 마치면 가입이 끝나요">
        <div className={codeStyles.form}>
          <span className={codeStyles.icon} aria-hidden="true">
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
              <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
            </svg>
          </span>
          <h1 className={codeStyles.title}>이메일 인증</h1>
          <p className={codeStyles.lead}>
            <b className={codeStyles.email}>{body.email}</b>으로 보낸 6자리 숫자를 입력해 주세요.
          </p>
          <CodeStep
            initial={codeStep.times}
            autoFocus
            check={async (code) => {
              await confirmSignup({ email: body.email, code }).catch(alreadyJoined)
              showToast('가입을 마쳤어요')
            }}
            resend={() => signup(body).catch(alreadyJoined)}
            onVerified={() => {}}
          />
          <p className={codeStyles.hint}>메일이 안 왔나요? 스팸함을 확인하거나 새 코드를 받아 주세요.</p>
          {/* 주소를 잘못 쓴 사용자가 돌아갈 길. 입력한 내용은 그대로 남는다 */}
          <button type="button" className={`${codeStyles.linkButton} ${codeStyles.back}`} onClick={editEmail}>
            이메일 고치기
          </button>
        </div>
      </AuthLayout>
    )
  }

  const allAgreed = agreeAge && agreeTerms && agreePrivacy
  // 동의 오류면 체크하지 않은 필수 항목이 오류 칸이다(첫 항목으로 포커스, 2.5)
  const requiredCheck = (checked: boolean) =>
    errors.agreements && !checked
      ? { 'aria-invalid': true as const, 'aria-describedby': 'signup-agreements-error' }
      : {}

  return (
    <AuthLayout
      heading={
        <>
          이메일과 비밀번호로
          <br />
          가입할 수 있습니다
        </>
      }
    >
      <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
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
                setAgreeAge(e.target.checked)
                setAgreeTerms(e.target.checked)
                setAgreePrivacy(e.target.checked)
              }}
            />
            전체 동의
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={agreeAge}
              onChange={(e) => setAgreeAge(e.target.checked)}
              {...requiredCheck(agreeAge)}
            />
            <span className={styles.checkText}>[필수] 만 14세 이상입니다</span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              {...requiredCheck(agreeTerms)}
            />
            <span className={styles.checkText}>[필수] 이용약관 동의</span>
            <Link className={styles.checkLink} to="/terms" target="_blank">
              내용 보기
            </Link>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
              {...requiredCheck(agreePrivacy)}
            />
            <span className={styles.checkText}>[필수] 개인정보 수집·이용 동의</span>
            <Link className={styles.checkLink} to="/privacy" target="_blank">
              내용 보기
            </Link>
          </label>
          <p className={styles.overseas}>
            회원 정보와 서비스 이용 기록은 싱가포르 소재 서버(Railway)에 보관되며, 메일 발송 등 일부 업무는 국외 업체에
            위탁하여 처리합니다.{' '}
            <Link to="/privacy#legal-3" target="_blank">
              자세히 보기
            </Link>
          </p>
        </fieldset>
        {errors.agreements && (
          <p id="signup-agreements-error" className={`${styles.fieldError} ${styles.tight}`}>
            {errors.agreements}
          </p>
        )}

        <button type="submit" className={styles.submit} aria-disabled={submitting} aria-busy={submitting}>
          {submitting ? '인증번호 보내는 중…' : '회원가입'}
        </button>
        {notice && (
          <p role="alert" className={`${styles.fieldError} ${styles.tight}`}>
            {notice}
          </p>
        )}
        <p className={styles.note}>입력한 이메일로 인증번호가 발송되며, 인증을 마치면 가입이 완료됩니다.</p>
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

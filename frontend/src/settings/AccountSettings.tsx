// SCR-SET-06 설정 — 계정 (P4-08, 목업 SET-06·SET-06s). ① 이메일·인증 상태 ② 비밀번호 변경(D-173) ③ 로그아웃.
// 개인정보 처리방침·이용약관·회원 탈퇴 줄은 해당 화면을 만드는 P4-05에서 더한다.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { authApi } from '../api'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { passwordViolations, type PasswordRuleCode } from '../auth/passwordRules'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { EmailVerificationDialog } from '../verification/EmailVerificationDialog'
import account from './account.module.css'
import styles from './settings.module.css'

const RULES: { code: PasswordRuleCode; label: string }[] = [
  { code: 'PASSWORD_LENGTH', label: '8~64자' },
  { code: 'PASSWORD_LETTER_DIGIT_REQUIRED', label: '영문·숫자 포함' },
  { code: 'PASSWORD_SAME_AS_EMAIL', label: '이메일과 다른 문자열' },
]
const REQUIRED = '입력해 주세요'
const TOO_LONG = '비밀번호가 너무 길어요. 한글은 한 글자가 더 많은 자리를 차지해요'
const SAME_AS_CURRENT = '지금 쓰는 비밀번호와 다르게 정해 주세요'
const RULE_FAILED = '비밀번호 규칙을 확인해 주세요'
const MISMATCH = '현재 비밀번호가 맞지 않아요'
const CONFIRM_MISMATCH = '새 비밀번호와 같게 입력해 주세요'

type Field = 'current' | 'next' | 'confirm'
type Values = Record<Field, string>
type Errors = Partial<Record<Field, string>>
const FIELD_IDS: Record<Field, string> = {
  current: 'account-current-password',
  next: 'account-new-password',
  confirm: 'account-confirm-password',
}

/** 새 비밀번호 칸 오류 문구. 코드는 contracts/identity.yaml ValidationFailed와 같다 */
function newPasswordMessage(codes: string[]): string | undefined {
  if (codes.length === 0) return undefined
  if (codes.includes('REQUIRED')) return REQUIRED
  if (codes.includes('PASSWORD_TOO_LONG_BYTES')) return TOO_LONG
  if (codes.every((c) => c === 'PASSWORD_SAME_AS_CURRENT')) return SAME_AS_CURRENT
  return RULE_FAILED
}

/** 지금부터 seconds초 뒤의 시각(ms) */
function secondsFromNow(seconds: number): number {
  return Date.now() + seconds * 1000
}

function confirmError(values: Values): string | undefined {
  if (!values.confirm) return REQUIRED
  return values.confirm === values.next ? undefined : CONFIRM_MISMATCH
}

export function AccountSettings() {
  const { user, logout } = useAuth()
  const [dialogOpen, setDialogOpen] = useState(false)
  const verifyButton = useRef<HTMLButtonElement>(null)
  if (!user) return null

  return (
    <div className={account.stack}>
      <section aria-labelledby="settings-account" className={`${styles.panel} ${account.card}`}>
        <h2 id="settings-account" className={account.cardTitle}>
          계정
        </h2>
        <div className={account.emailRow}>
          <div className={account.emailText}>
            <div className={account.email}>{user.email}</div>
            {user.emailVerified ? (
              <span className={account.verified}>
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l5 5 9-10" />
                </svg>
                인증됨
              </span>
            ) : (
              <div className={account.unverified}>이메일 미인증 · 일지 내보내기 전에 인증이 필요해요</div>
            )}
          </div>
          {!user.emailVerified && (
            <button ref={verifyButton} type="button" className={account.verify} onClick={() => setDialogOpen(true)}>
              인증하기
            </button>
          )}
        </div>
      </section>

      <PasswordChange email={user.email} timeZone={user.timezone} />

      <section aria-label="계정 관리" className={`${styles.panel} ${account.links}`}>
        <button type="button" className={account.linkRow} onClick={() => void logout()}>
          로그아웃
          <span aria-hidden="true">›</span>
        </button>
      </section>

      {dialogOpen && (
        <EmailVerificationDialog
          onClose={() => {
            setDialogOpen(false)
            verifyButton.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function PasswordChange({ email, timeZone }: { email: string; timeZone: string }) {
  const { clearSession } = useAuth()
  const { showToast } = useToast()
  const [values, setValues] = useState<Values>({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)
  const locked = lockedUntil > 0
  const lockBand = useRef<HTMLParagraphElement>(null)
  const refocusAfterLock = useRef(false)

  // 잠기면 버튼이 꺼지므로 포커스를 띠로 옮긴다. 잠금 시각이 지나면 띠를 걷고 칸을 다시 켠 뒤 현재 비밀번호 칸으로
  useEffect(() => {
    if (!lockedUntil) {
      if (refocusAfterLock.current) document.getElementById(FIELD_IDS.current)?.focus()
      refocusAfterLock.current = false
      return
    }
    lockBand.current?.focus()
    const timer = setTimeout(
      () => {
        refocusAfterLock.current = lockBand.current?.contains(document.activeElement) ?? false
        setLockedUntil(0)
      },
      Math.max(0, lockedUntil - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [lockedUntil])

  const violations = passwordViolations(values.next, email)
  const tooLong = violations.includes('PASSWORD_TOO_LONG_BYTES')
  const inactive = busy || locked

  const set = (field: Field, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    // 고치기 시작하면 그 칸의 오류는 지운다(입력 중 경고는 규칙 목록·바이트 초과만)
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const showErrors = (next: Errors) => {
    setErrors(next)
    const first = (['current', 'next', 'confirm'] as const).find((f) => next[f])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (inactive) return
    const next: Errors = {}
    if (!values.current) next.current = REQUIRED
    if (!values.next) next.next = REQUIRED
    else if (violations.length) next.next = newPasswordMessage(violations)
    else if (values.next === values.current) next.next = SAME_AS_CURRENT
    if (!next.next) next.confirm = confirmError(values)
    if (next.current || next.next || next.confirm) return showErrors(next)

    setErrors({})
    setBusy(true)
    try {
      const result = await authApi.changePassword({ currentPassword: values.current, newPassword: values.next })
      if (!result.currentSessionKept) {
        // 서버가 이 기기도 로그아웃시켰다(쿠키 삭제). 가드가 로그인 화면으로 보내고 그 화면이 안내한다
        clearSession('passwordChanged')
        return
      }
      setValues({ current: '', next: '', confirm: '' })
      showToast('비밀번호를 바꿨어요. 다른 기기에서는 로그아웃됐어요')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CURRENT_PASSWORD_MISMATCH') {
        showErrors({ current: MISMATCH })
      } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const codesOf = (field: string) =>
          err.problem?.errors?.filter((x) => x.field === field).map((x) => x.code) ?? []
        showErrors({
          current: codesOf('currentPassword').length ? REQUIRED : undefined,
          next: newPasswordMessage(codesOf('newPassword')),
        })
      } else if (err instanceof ApiError && err.status === 429) {
        const seconds = err.problem?.retryAfterSeconds ?? 15 * 60
        setLockedUntil(secondsFromNow(seconds))
      } else {
        const toast = toastForError(err)
        showToast(toast.message, { traceId: toast.traceId })
      }
    } finally {
      setBusy(false)
    }
  }

  const errorId = (field: Field) => `${FIELD_IDS[field]}-error`
  const nextError = tooLong ? TOO_LONG : errors.next

  return (
    <section aria-labelledby="settings-password" className={`${styles.panel} ${account.card}`}>
      <h2 id="settings-password" className={account.cardTitle}>
        비밀번호 변경
      </h2>
      {locked && (
        <p ref={lockBand} role="alert" tabIndex={-1} className={account.lockBand}>
          현재 비밀번호를 여러 번 틀려서 잠시 바꿀 수 없어요.{' '}
          {new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
            lockedUntil,
          )}{' '}
          이후에 다시 시도해 주세요.
        </p>
      )}
      <form className={account.form} onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        {/* 비밀번호 관리자가 어느 계정의 비밀번호인지 알게 한다 */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        {/* 제출 중에도 누른 버튼에 포커스가 남도록 disabled 대신 readOnly·aria-disabled. 잠금 중에는 칸을 끈다 */}
        <PasswordField
          field="current"
          label="현재 비밀번호"
          autoComplete="current-password"
          value={values.current}
          onChange={set}
          error={errors.current}
          describedBy={errors.current ? errorId('current') : undefined}
          busy={busy}
          disabled={locked}
        />
        <div className={account.pair}>
          <div className={account.column}>
            <PasswordField
              field="next"
              label="새 비밀번호"
              autoComplete="new-password"
              placeholder="8~64자, 영문·숫자 포함"
              value={values.next}
              onChange={set}
              error={nextError}
              describedBy={['account-password-rules', nextError && errorId('next')].filter(Boolean).join(' ')}
              busy={busy}
              disabled={locked}
            />
            <ul id="account-password-rules" className={account.rules} aria-label="비밀번호 규칙">
              {RULES.map((rule) => {
                const ok = values.next !== '' && !violations.includes(rule.code)
                return (
                  <li key={rule.code} className={ok ? account.ruleOk : undefined}>
                    {ok ? '✓' : '○'} {rule.label}
                    <span className={account.srOnly}>{ok ? ' 충족' : ' 미충족'}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <PasswordField
            field="confirm"
            label="새 비밀번호 확인"
            autoComplete="new-password"
            placeholder="한 번 더"
            value={values.confirm}
            onChange={set}
            // 확인 칸에서 벗어날 때도 비교한다(빈 칸은 제출 때만)
            onBlur={() => {
              if (values.confirm && values.confirm !== values.next)
                setErrors((p) => ({ ...p, confirm: CONFIRM_MISMATCH }))
            }}
            error={errors.confirm}
            describedBy={errors.confirm ? errorId('confirm') : undefined}
            busy={busy}
            disabled={locked}
          />
        </div>
        <div className={account.footer}>
          <p className={account.notice}>
            바꾸면 <b>다른 기기에서 로그아웃</b>돼요. 지금 이 기기는 그대로예요.
          </p>
          <button type="submit" className={account.submit} aria-disabled={inactive || undefined} disabled={locked}>
            {busy && (
              <svg
                aria-hidden="true"
                className={account.spinner}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
            )}
            {busy ? '바꾸는 중…' : '비밀번호 변경'}
          </button>
        </div>
      </form>
    </section>
  )
}

interface PasswordFieldProps {
  field: Field
  label: string
  autoComplete: string
  placeholder?: string
  value: string
  onChange: (field: Field, value: string) => void
  onBlur?: () => void
  error: string | undefined
  describedBy: string | undefined
  busy: boolean
  disabled: boolean
}

function PasswordField(props: PasswordFieldProps) {
  const { field, label, autoComplete, placeholder, value, onChange, onBlur, error, describedBy, busy, disabled } = props
  const id = FIELD_IDS[field]
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        className={styles.input}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        onBlur={onBlur}
        readOnly={busy}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {error && (
        <p id={`${id}-error`} className={account.fieldError}>
          {error}
        </p>
      )}
    </div>
  )
}

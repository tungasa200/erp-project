// SCR-SET-07 회원 탈퇴 (P4-05, 목업 SET-07·SET-07s, D-176). 설정 › 계정 › 회원 탈퇴.
// 확인은 비밀번호 재입력만 하고 확인 창 없이 바로 처리한다(카드 0210 — '탈퇴' 글자 입력 칸 없음). 말투는 사무적(D-36).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { authApi } from '../api'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import account from './account.module.css'
import styles from './deletion.module.css'
import settings from './settings.module.css'

const PASSWORD_ID = 'deletion-password'
const MISMATCH = '비밀번호가 일치하지 않습니다.'
const REQUIRED = '비밀번호를 입력해 주십시오.'

export function AccountDeletion() {
  const { user, clearSession } = useAuth()
  const { showToast } = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)
  const locked = lockedUntil > 0
  const lockBand = useRef<HTMLParagraphElement>(null)
  const refocusAfterLock = useRef(false)

  // 잠기면 칸·버튼이 꺼지므로 포커스를 띠로 옮기고, 풀리면 띠를 걷고 비밀번호 칸으로 (SCR-SET-06과 같은 처리)
  useEffect(() => {
    if (!lockedUntil) {
      if (refocusAfterLock.current) document.getElementById(PASSWORD_ID)?.focus()
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

  if (!user) return null

  const showError = (message: string) => {
    setPassword('')
    setError(message)
    document.getElementById(PASSWORD_ID)?.focus()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || locked || !password) return
    setError(undefined)
    setBusy(true)
    try {
      await authApi.deleteAccount({ password })
      // 서버가 쿠키를 지웠다. 가드가 로그인 화면으로 보내고 그 화면이 완료 안내 띠를 띄운다
      clearSession('withdrawn')
      return
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PASSWORD_MISMATCH') showError(MISMATCH)
      else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') showError(REQUIRED)
      else if (err instanceof ApiError && err.status === 429) {
        setPassword('')
        setLockedUntil(Date.now() + (err.problem?.retryAfterSeconds ?? 15 * 60) * 1000)
      } else {
        const toast = toastForError(err)
        showToast(toast.message, { traceId: toast.traceId })
      }
    }
    setBusy(false)
  }

  return (
    <div className={styles.page}>
      <Link to="/settings/account" className={styles.back}>
        <span aria-hidden="true">←</span>&nbsp;계정
      </Link>
      <form
        aria-labelledby="deletion-title"
        className={`${settings.panel} ${styles.card}`}
        onSubmit={(e) => void submit(e)}
        noValidate
        aria-busy={busy}
      >
        <h1 id="deletion-title" className={styles.title}>
          회원 탈퇴
        </h1>
        {locked && (
          <p ref={lockBand} role="alert" tabIndex={-1} className={account.lockBand}>
            비밀번호를 여러 번 잘못 입력하여 잠시 탈퇴할 수 없습니다.{' '}
            {new Intl.DateTimeFormat('ko-KR', {
              timeZone: user.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(lockedUntil)}{' '}
            이후에 다시 시도해 주십시오.
          </p>
        )}
        <div className={styles.warning}>
          <h2 className={styles.warningTitle}>탈퇴하면 아래 데이터가 모두 삭제되며 되돌릴 수 없습니다</h2>
          <ul className={styles.warningList}>
            <li>업무와 보관한 업무·프로젝트</li>
            <li>일정과 반복 일정 전체</li>
            <li>업무 기록</li>
            <li>작성하거나 확정한 업무일지</li>
          </ul>
          {/* 시간은 처리방침 초안 2장 1(D-176)과 같게 둔다 */}
          <p className={styles.warningNote}>
            계정 정보는 즉시 삭제됩니다. 업무 데이터는 탈퇴 후 보통 1분 안에, 늦어도 20분 안에(서버 점검 중이었다면 다시
            켜진 직후) 모두 삭제되며, 백업본에 남은 데이터는 7일 이내에 자동으로 삭제됩니다.
          </p>
        </div>
        <div className={styles.export}>
          <span className={styles.exportText}>회사에 제출할 업무일지가 있다면 탈퇴 전에 내려받으시기 바랍니다</span>
          <Link to="/logs" className={styles.exportLink}>
            일지 목록으로 이동
          </Link>
        </div>
        {/* 비밀번호 관리자가 어느 계정의 비밀번호인지 알게 한다 */}
        <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <div className={settings.field}>
          <label htmlFor={PASSWORD_ID} className={settings.label}>
            비밀번호
          </label>
          <input
            id={PASSWORD_ID}
            type="password"
            className={`${settings.input} ${styles.input}`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError(undefined)
            }}
            readOnly={busy}
            disabled={locked}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${PASSWORD_ID}-error` : `${PASSWORD_ID}-hint`}
          />
          {error ? (
            <p id={`${PASSWORD_ID}-error`} className={account.fieldError}>
              {error}
            </p>
          ) : (
            <p id={`${PASSWORD_ID}-hint`} className={styles.hint}>
              본인 확인을 위해 현재 비밀번호를 입력합니다.
            </p>
          )}
        </div>
        {/* 제출 중에도 누른 버튼에 포커스가 남도록 disabled 대신 aria-disabled. 비밀번호가 비었거나 잠기면 끈다 */}
        <button
          type="submit"
          className={styles.submit}
          disabled={locked || (!password && !busy)}
          aria-disabled={busy || undefined}
        >
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
          {busy ? '탈퇴 처리 중…' : '회원 탈퇴'}
        </button>
      </form>
    </div>
  )
}

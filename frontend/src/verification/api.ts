// 이메일 인증(AUTH-08, P1-12)·비밀번호 재설정(AUTH-03, P1-13) API (identity 생성 타입).
import { api } from '../api'
import type { components } from '../api/generated/identity'
import { ApiError } from '../api/problem'
import type { Me } from '../api/types'
import { formatMinutes, toZoned } from '../calendar/time'

type Schemas = components['schemas']
/** 코드를 새로 발급했을 때의 시각 (UTC ISO) */
export type CodeIssued = Schemas['CodeIssued']
export type EmailVerificationStatus = Schemas['EmailVerificationStatus']
type CodeRejectedProblem = Schemas['CodeRejectedProblem']

export const verificationApi = {
  status: () => api.request<EmailVerificationStatus>('/api/users/me/email-verification'),
  send: () => api.request<CodeIssued>('/api/users/me/email-verification', { method: 'POST' }),
  confirm: (code: string) =>
    api.request<Me>('/api/users/me/email-verification/confirm', { method: 'POST', body: { code } }),
}

export const passwordResetApi = {
  request: (email: string) => api.request<CodeIssued>('/api/auth/password-reset', { method: 'POST', body: { email } }),
  verify: (email: string, code: string) =>
    api.request<void>('/api/auth/password-reset/verify', { method: 'POST', body: { email, code } }),
  confirm: (email: string, code: string, newPassword: string) =>
    api.request<void>('/api/auth/password-reset/confirm', { method: 'POST', body: { email, code, newPassword } }),
}

export interface CodeTimes {
  /** null: 유효한 코드가 없음(잠금). undefined: 코드는 보냈지만 만료 시각을 모름 */
  expiresAt?: Date | null
  resendAt?: Date | null
}

export function timesOf(issued: CodeIssued): CodeTimes {
  return {
    expiresAt: issued.expiresAt ? new Date(issued.expiresAt) : undefined,
    resendAt: issued.resendAvailableAt ? new Date(issued.resendAvailableAt) : null,
  }
}

/** 코드 확인 실패를 화면 상태로 바꾼다 (contracts/identity.yaml CodeRejected) */
export type CodeFailure =
  { kind: 'mismatch'; attemptsRemaining: number } | { kind: 'expired' } | { kind: 'other'; error: unknown }

export function codeFailure(error: unknown): CodeFailure {
  if (error instanceof ApiError && error.code === 'CODE_MISMATCH') {
    const remaining = (error.problem as CodeRejectedProblem | null)?.attemptsRemaining ?? 0
    // 0이면 다음 입력부터 CODE_EXPIRED라 바로 잠근다
    return remaining > 0 ? { kind: 'mismatch', attemptsRemaining: remaining } : { kind: 'expired' }
  }
  if (error instanceof ApiError && error.code === 'CODE_EXPIRED') return { kind: 'expired' }
  return { kind: 'other', error }
}

/**
 * 발송 제한(429 SendLimited) 안내. 다시 받을 수 있는 시각도 돌려준다.
 * 발송 한도는 보낸 시각부터 24시간(rolling, D-64)이라 자정에 풀리지 않으므로 "내일" 대신 다시 받을 수 있는 시각을 쓴다.
 * 시각은 timeZone(로그인 전이면 브라우저 시간대)으로 보인다.
 */
export function sendLimitMessage(
  error: unknown,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { code: string | undefined; message: string; retryAt: Date | null } | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null
  const seconds = error.problem?.retryAfterSeconds
  const retryAt = seconds === undefined ? null : new Date(Date.now() + seconds * 1000)
  const message =
    error.code === 'DAILY_SEND_LIMIT'
      ? retryAt
        ? `코드는 24시간에 10통까지 받을 수 있어요. ${formatMinutes(toZoned(retryAt.getTime(), timeZone).minutes)} 이후에 다시 받을 수 있어요`
        : '코드는 24시간에 10통까지 받을 수 있어요'
      : error.code === 'RESEND_TOO_SOON'
        ? '방금 코드를 보냈어요. 잠시 후 다시 받을 수 있어요'
        : '요청이 많아요. 잠시 후 다시 시도해 주세요'
  return { code: error.code, message, retryAt }
}

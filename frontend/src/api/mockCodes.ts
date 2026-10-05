// 개발용 가짜 인증 코드 (이메일 인증 P1-12, 비밀번호 재설정 P1-13). 코드는 항상 123456이다.
// 10분 유효, 5회 입력, 다시 받기는 60초 뒤. 탭을 새로 고치면 초기화된다(메모리에만 둔다).
const CODE = '123456'
const TTL_MS = 10 * 60 * 1000
const RESEND_MS = 60 * 1000

interface CodeState {
  expiresAt: number
  resendAt: number
  attempts: number
}

const codes = new Map<string, CodeState>()

export type CodeResult = { ok: true } | { ok: false; code: string; extra?: Record<string, unknown> }

/** 새 코드 발급. 60초 안이면 RESEND_TOO_SOON */
export function issueCode(
  key: string,
): { expiresAt: string; resendAvailableAt: string } | { retryAfterSeconds: number } {
  const now = Date.now()
  const current = codes.get(key)
  if (current && current.resendAt > now) return { retryAfterSeconds: Math.ceil((current.resendAt - now) / 1000) }
  const next = { expiresAt: now + TTL_MS, resendAt: now + RESEND_MS, attempts: 5 }
  codes.set(key, next)
  return { expiresAt: new Date(next.expiresAt).toISOString(), resendAvailableAt: new Date(next.resendAt).toISOString() }
}

/** 코드 확인. consume이면 맞았을 때 코드를 쓴 것으로 처리한다 */
export function checkCode(key: string, code: unknown, consume: boolean): CodeResult {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { ok: false, code: 'VALIDATION_FAILED', extra: { errors: [{ field: 'code', code: 'CODE_FORMAT' }] } }
  }
  const state = codes.get(key)
  if (!state || state.expiresAt < Date.now() || state.attempts <= 0) return { ok: false, code: 'CODE_EXPIRED' }
  if (code !== CODE) {
    state.attempts -= 1
    return { ok: false, code: 'CODE_MISMATCH', extra: { attemptsRemaining: state.attempts } }
  }
  if (consume) codes.delete(key)
  return { ok: true }
}

export function codeStatus(key: string) {
  const state = codes.get(key)
  const now = Date.now()
  const valid = state && state.expiresAt > now && state.attempts > 0
  return {
    expiresAt: valid ? new Date(state.expiresAt).toISOString() : null,
    attemptsRemaining: valid ? state.attempts : null,
    resendAvailableAt: state && state.resendAt > now ? new Date(state.resendAt).toISOString() : null,
  }
}

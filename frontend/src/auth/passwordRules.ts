// 비밀번호 규칙 (AUTH-01, D-38). 코드 이름은 contracts/identity.yaml ValidationFailed의 errors[].code와 같다.
export type PasswordRuleCode =
  'PASSWORD_LENGTH' | 'PASSWORD_LETTER_DIGIT_REQUIRED' | 'PASSWORD_SAME_AS_EMAIL' | 'PASSWORD_TOO_LONG_BYTES'

export function passwordViolations(password: string, email: string): PasswordRuleCode[] {
  const out: PasswordRuleCode[] = []
  const length = [...password].length
  if (length < 8 || length > 64) out.push('PASSWORD_LENGTH')
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) out.push('PASSWORD_LETTER_DIGIT_REQUIRED')
  const normalizedEmail = email.trim().toLowerCase()
  if (password.length > 0 && password.toLowerCase() === normalizedEmail) out.push('PASSWORD_SAME_AS_EMAIL')
  if (new TextEncoder().encode(password).length > 72) out.push('PASSWORD_TOO_LONG_BYTES')
  return out
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

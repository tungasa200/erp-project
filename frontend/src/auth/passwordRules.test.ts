import { describe, expect, it } from 'vitest'
import { passwordViolations } from './passwordRules'

describe('passwordViolations', () => {
  it('규칙을 모두 지키면 빈 배열', () => {
    expect(passwordViolations('worklog20', 'a@b.com')).toEqual([])
  })

  it('길이·영문숫자 위반을 함께 돌려준다', () => {
    expect(passwordViolations('abc', 'a@b.com')).toEqual(['PASSWORD_LENGTH', 'PASSWORD_LETTER_DIGIT_REQUIRED'])
  })

  it('이메일과 같으면 대소문자를 무시하고 위반', () => {
    expect(passwordViolations('User1@Mail.com', ' user1@mail.com ')).toContain('PASSWORD_SAME_AS_EMAIL')
  })

  it('한글은 3바이트라 25자부터 72바이트를 넘는다', () => {
    const hangul24 = '가'.repeat(23) + 'a1' // 69 + 2 = 71바이트
    const hangul25 = '가'.repeat(24) + 'a1' // 72 + 2 = 74바이트
    expect(passwordViolations(hangul24, 'a@b.com')).not.toContain('PASSWORD_TOO_LONG_BYTES')
    expect(passwordViolations(hangul25, 'a@b.com')).toContain('PASSWORD_TOO_LONG_BYTES')
  })

  it('글자 수는 UTF-16 길이가 아니라 문자 수로 센다', () => {
    // 이모지 4개 + a1 = 6자 (UTF-16 길이로는 10)
    expect(passwordViolations('😀😀😀😀a1', 'a@b.com')).toContain('PASSWORD_LENGTH')
  })
})

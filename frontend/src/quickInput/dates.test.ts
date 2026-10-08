import { describe, expect, it } from 'vitest'
import { shortDate } from './dates'

describe('shortDate', () => {
  it('올해면 연도 없이, 다른 해면 연도를 앞에 붙인다', () => {
    expect(shortDate('2026-10-08', '2026-10-08')).toBe('10/8(목)')
    expect(shortDate('2025-10-03', '2026-10-08')).toBe('2025/10/3(금)')
    expect(shortDate('2027-01-02', '2026-12-31')).toBe('2027/1/2(토)')
  })
})

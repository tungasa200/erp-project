import { describe, expect, it } from 'vitest'
import { colsFor } from './useHomeLayout'

describe('홈 본문 열 수 (홈PC 재디자인 v2 ②a)', () => {
  it('본문 폭 912 이상 3열, 600~911 2열, 600 미만 1열', () => {
    expect(colsFor(1392)).toBe(3)
    expect(colsFor(912)).toBe(3)
    expect(colsFor(911)).toBe(2)
    expect(colsFor(600)).toBe(2)
    expect(colsFor(599)).toBe(1)
    expect(colsFor(0)).toBe(1)
  })
})

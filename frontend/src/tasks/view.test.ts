import { describe, expect, it } from 'vitest'
import { dueLabel, dueState } from './view'

// 업무 목록·홈 남은 업무의 기한 칩이 같은 함수를 쓴다(D-236 ③)
describe('기한 칩 글자·상태', () => {
  const today = '2026-10-07' // 수, 주 시작 월요일(1)

  it('올해는 연도 없이, 지난해는 형제 화면처럼 연도를 붙인다(shortDate)', () => {
    expect(dueLabel('2026-10-07', today)).toBe('오늘')
    expect(dueLabel('2026-10-08', today)).toBe('내일')
    expect(dueLabel('2026-10-06', today)).toBe('10/6(화)')
    expect(dueLabel('2025-10-06', today)).toBe('2025/10/6(월)')
    expect(dueLabel(null, today)).toBe('—')
  })

  it('지난해 날짜도 초과, 오늘은 오늘', () => {
    expect(dueState('2026-10-06', today, 1)).toBe('overdue')
    expect(dueState('2025-12-28', today, 1)).toBe('overdue')
    expect(dueState('2026-10-07', today, 1)).toBe('today')
    expect(dueState('2026-10-09', today, 1)).toBe('week')
    expect(dueState('2027-01-04', today, 1)).toBe('later')
  })
})

import { describe, expect, it } from 'vitest'
import { addDays, addMonths, fromZoned, monthGridStart, snapMinutes, startOfWeek, toZoned } from './time'

describe('날짜 계산', () => {
  it('월·연 경계를 넘는다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('주 시작 요일 설정을 따른다', () => {
    // 2026-10-07은 수요일
    expect(startOfWeek('2026-10-07', 'MONDAY')).toBe('2026-10-05')
    expect(startOfWeek('2026-10-07', 'SUNDAY')).toBe('2026-10-04')
    expect(startOfWeek('2026-10-04', 'MONDAY')).toBe('2026-09-28')
  })

  it('월 이동은 없는 날짜를 그달 마지막 날로 맞춘다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('월 보기 첫 칸은 1일이 든 주의 첫날', () => {
    expect(monthGridStart('2026-10-20', 'MONDAY')).toBe('2026-09-28')
  })

  it('15분 단위로 맞춘다', () => {
    expect(snapMinutes(7 * 60 + 52)).toBe(7 * 60 + 45)
    expect(snapMinutes(7 * 60 + 53)).toBe(8 * 60)
    expect(snapMinutes(-10)).toBe(0)
    expect(snapMinutes(1500)).toBe(1440)
  })
})

describe('시간대 변환', () => {
  it('서울 벽시계 ↔ UTC', () => {
    expect(fromZoned('2026-10-06', 9 * 60, 'Asia/Seoul')).toBe('2026-10-06T00:00:00.000Z')
    expect(toZoned('2026-10-05T15:30:00Z', 'Asia/Seoul')).toEqual({ date: '2026-10-06', minutes: 30 })
  })

  it('24:00은 다음 날 0시', () => {
    expect(fromZoned('2026-10-06', 1440, 'Asia/Seoul')).toBe(fromZoned('2026-10-07', 0, 'Asia/Seoul'))
  })

  it('서머타임으로 없는 시각은 뒤로, 두 번 있는 시각은 앞쪽', () => {
    // 뉴욕 2026-03-08 02:30은 없다 → 03:30 EDT
    expect(fromZoned('2026-03-08', 150, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z')
    // 2026-11-01 01:30은 두 번 → 앞쪽(EDT)
    expect(fromZoned('2026-11-01', 90, 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  })
})

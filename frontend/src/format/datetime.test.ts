import { describe, expect, it } from 'vitest'
import { clock, longDate, shortDate, stamp, timeRange, todayIn, toZoned } from './datetime'

describe('날짜·시간 공용 표기(X-13)', () => {
  it('시각은 기기 시간대가 아니라 넘긴 시간대로 바꾼다(SYS-02)', () => {
    const instant = '2026-10-08T15:30:00Z'
    expect(clock(instant, 'Asia/Seoul')).toBe('00:30')
    expect(clock(instant, 'America/New_York')).toBe('11:30')
    expect(toZoned(instant, 'Asia/Seoul')).toEqual({ date: '2026-10-09', minutes: 30 })
    expect(todayIn('Asia/Seoul', new Date(instant))).toBe('2026-10-09')
    expect(todayIn('UTC', new Date(instant))).toBe('2026-10-08')
  })

  it('짧은 날짜는 올해면 연도를 빼고 요일을 괄호에 붙인다', () => {
    expect(shortDate('2026-10-08', '2026-10-12')).toBe('10/8(목)')
    expect(shortDate('2025-10-08', '2026-10-12')).toBe('2025/10/8(수)')
    expect(longDate('2026-10-06')).toBe('2026년 10월 6일 (화)')
  })

  it('시간 범위는 "14:00 – 15:00", 날을 넘기면 끝에 짧은 날짜를 붙인다', () => {
    expect(timeRange('2026-10-08T05:00:00Z', '2026-10-08T06:00:00Z', 'Asia/Seoul')).toBe('14:00 – 15:00')
    expect(timeRange('2026-10-08T14:00:00Z', '2026-10-08T16:00:00Z', 'Asia/Seoul')).toMatch(
      /^23:00 – (\d{4}\/)?10\/9\(금\) 01:00$/,
    )
  })

  it('찍힌 시각은 "YYYY-MM-DD HH:MM"', () => {
    expect(stamp('2026-10-07T09:04:00Z', 'Asia/Seoul')).toBe('2026-10-07 18:04')
  })
})

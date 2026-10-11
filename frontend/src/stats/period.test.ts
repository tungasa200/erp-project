import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar/time'
import { MAX_WEEK_BARS, completedBuckets, readiness, weekAligned } from './buckets'
import { diffText, hoursText } from './format'
import { quickRanges, rangeError, rangeLabel, readPeriod, thisMonth, thisWeek, writePeriod } from './period'

describe('통계 기간', () => {
  it('이번 주는 주 시작 요일부터 7일, 이번 달은 1일부터 말일', () => {
    expect(thisWeek('2026-10-08', 'MONDAY')).toEqual({ kind: 'week', from: '2026-10-05', to: '2026-10-11' })
    expect(thisWeek('2026-10-08', 'SUNDAY')).toEqual({ kind: 'week', from: '2026-10-04', to: '2026-10-10' })
    expect(thisMonth('2026-02-14')).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28' })
  })

  it('주소에서 읽고 쓴다. 없거나 틀린 직접 선택은 이번 달', () => {
    const read = (q: string) => readPeriod(new URLSearchParams(q), '2026-10-08', 'MONDAY')
    expect(read('')).toEqual(thisMonth('2026-10-08'))
    expect(read('period=week').kind).toBe('week')
    expect(read('period=custom&from=2026-09-01&to=2026-09-30')).toEqual({
      kind: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(read('period=custom&from=2026-09-30&to=2026-09-01').kind).toBe('month')
    expect(writePeriod({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }).toString()).toBe(
      'period=custom&from=2026-09-01&to=2026-09-30',
    )
    expect(writePeriod(thisMonth('2026-10-08')).toString()).toBe('')
  })

  it('직접 선택 검사: 순서, 400일', () => {
    expect(rangeError('2026-09-01', '2026-09-30')).toBeNull()
    expect(rangeError('2026-09-30', '2026-09-01')).toBe('시작일을 종료일보다 앞으로 골라 주세요')
    expect(rangeError('2025-09-01', '2026-10-05')).toBeNull() // 400일
    expect(rangeError('2025-09-01', '2026-10-06')).toBe('기간은 400일까지 고를 수 있어요')
    expect(rangeError('', '2026-10-06')).toBe('시작일과 종료일을 골라 주세요')
  })

  it('빠른 선택: 지난주, 지난달, 최근 3개월', () => {
    expect(quickRanges('2026-10-08', 'MONDAY')).toEqual([
      { label: '지난주', from: '2026-09-28', to: '2026-10-04' },
      { label: '지난달', from: '2026-09-01', to: '2026-09-30' },
      { label: '최근 3개월', from: '2026-07-09', to: '2026-10-08' },
    ])
  })

  it('표시: 해가 다르면 연도를 붙인다', () => {
    expect(rangeLabel('2026-09-01', '2026-09-30', '2026-10-08')).toBe('9/1–9/30')
    expect(rangeLabel('2025-12-29', '2026-01-04', '2026-10-08')).toBe('2025/12/29–1/4')
  })
})

describe('통계 숫자', () => {
  it('시간은 0.5시간 단위, 1시간 미만은 분', () => {
    expect(hoursText(45)).toBe('45분')
    expect(hoursText(60 * 31)).toBe('31시간')
    expect(hoursText(60 * 33 + 30)).toBe('33.5시간')
    expect(diffText(60 * 31, 60 * 34)).toBe('+3시간')
    expect(diffText(60 * 35, 60 * 33 + 30)).toBe('−1.5시간')
    expect(diffText(60, 60)).toBe('0')
  })

  it('하루 단위를 주로 묶고(기간 안쪽만), 주가 많으면 달로 묶는다', () => {
    const daily = (from: string, days: number) =>
      Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), completedTaskCount: 1, recordCount: 0 }))
    const month = completedBuckets(daily('2026-10-01', 31), 'MONDAY', '2026-10-08')
    expect(month.map((b) => [b.long, b.value])).toEqual([
      ['10/1–10/4', 4],
      ['10/5–10/11', 7],
      ['10/12–10/18', 7],
      ['10/19–10/25', 7],
      ['10/26–10/31', 6],
    ])
    const long = completedBuckets(daily('2026-07-01', 92), 'MONDAY', '2026-10-08')
    expect(long.length).toBeLessThan(MAX_WEEK_BARS)
    expect(long.map((b) => [b.label, b.value])).toEqual([
      ['7월', 31],
      ['8월', 31],
      ['9월', 30],
    ])
  })

  it('첫 기록에서 7일이 지나야 보인다', () => {
    expect(readiness(null, '2026-10-08')).toEqual({ ready: false, daysLeft: null })
    expect(readiness('2026-10-05', '2026-10-08')).toEqual({ ready: false, daysLeft: 4 })
    expect(readiness('2026-10-01', '2026-10-08').ready).toBe(true)
  })

  it('예상 대비 실제는 주 단위로 맞춰 부른다', () => {
    expect(weekAligned('2026-10-01', '2026-10-31', 'MONDAY')).toEqual({ from: '2026-09-28', to: '2026-11-01' })
    expect(weekAligned('2025-09-01', '2026-10-05', 'MONDAY')).toEqual({ from: '2025-09-01', to: '2026-10-05' })
  })
})

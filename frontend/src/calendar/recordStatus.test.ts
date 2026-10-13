import { describe, expect, it } from 'vitest'
import type { WorkRecord } from '../records/api'
import type { Occurrence } from './api'
import { blockStateOf } from './recordStatus'

// 블록·칩의 기록 상태(화면정의서 2.3)
const o = {
  scheduleId: 's-1',
  occurrenceStart: '2026-10-07T01:00:00Z',
  title: '회의',
  allDay: false,
  startAt: '2026-10-07T01:00:00Z',
  endAt: '2026-10-07T02:00:00Z',
} as Occurrence
const record = (status: WorkRecord['status'], extra: Partial<WorkRecord> = {}) =>
  ({ id: 'r', status, scheduleId: 's-1', occurrenceStart: o.occurrenceStart, ...extra }) as WorkRecord
const before = Date.parse('2026-10-07T00:00:00Z')
const during = Date.parse('2026-10-07T01:30:00Z')
const after = Date.parse('2026-10-07T03:00:00Z')

describe('blockStateOf', () => {
  it('기록이 없으면 시각에 따라 계획·진행 중', () => {
    expect(blockStateOf(o, [], before, 'UTC')).toBe('plan')
    expect(blockStateOf(o, [], during, 'UTC')).toBe('now')
    expect(blockStateOf(o, [], after, 'UTC')).toBe('plan')
  })

  it('기록이 있으면 그 상태: 했어요·안 했어요', () => {
    expect(blockStateOf(o, [record('CONFIRMED')], during, 'UTC')).toBe('done')
    expect(blockStateOf(o, [record('DISMISSED')], after, 'UTC')).toBe('skipped')
  })

  it('확인 대기는 끝난 회차만(D-31), 끝나기 전이면 진행 중', () => {
    expect(blockStateOf(o, [record('PENDING')], after, 'UTC')).toBe('pending')
    expect(blockStateOf(o, [record('PENDING')], during, 'UTC')).toBe('now')
  })

  it('보관한 기록·다른 회차의 기록은 보지 않는다', () => {
    expect(blockStateOf(o, [record('CONFIRMED', { deletedAt: '2026-10-07T03:00:00Z' })], after, 'UTC')).toBe('plan')
    expect(blockStateOf(o, [record('CONFIRMED', { occurrenceStart: '2026-10-08T01:00:00Z' })], after, 'UTC')).toBe(
      'plan',
    )
  })
})

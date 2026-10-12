import { describe, expect, it } from 'vitest'
import type { Occurrence } from './api'
import { capColumns, timedSegments } from './layout'

const DAY = '2026-10-07'
const timed = (id: string, start: string, end: string) =>
  ({
    scheduleId: id,
    title: id,
    allDay: false,
    startAt: `${DAY}T${start}:00Z`,
    endAt: `${DAY}T${end}:00Z`,
  }) as Occurrence

const columnsOf = (occurrences: Occurrence[]) =>
  timedSegments(occurrences, [DAY], 'UTC')
    .get(DAY)!
    .map((s) => [s.occurrence.scheduleId, s.column, s.columns])

describe('시간 블록 배치', () => {
  it('이어진 15분 블록은 최소 30분 높이로 그려지므로 나란히 놓는다', () => {
    expect(columnsOf([timed('a', '09:00', '09:15'), timed('b', '09:15', '09:30')])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ])
  })

  it('30분 이상 떨어진 짧은 블록과 이어진 긴 블록은 한 열로 둔다', () => {
    expect(columnsOf([timed('a', '09:00', '09:15'), timed('b', '09:30', '09:45')])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ])
    expect(columnsOf([timed('a', '09:00', '10:00'), timed('b', '10:00', '11:00')])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ])
  })

  it('23:30 위치로 올려 그린 23:45 블록도 그 자리의 일정과 나란히 놓는다', () => {
    expect(columnsOf([timed('a', '23:00', '23:40'), timed('b', '23:45', '23:59')])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ])
  })
})

describe('겹침 상한 + "+n" (CAL-70, X-07 A)', () => {
  const six = [
    timed('a', '14:00', '15:00'),
    timed('b', '14:00', '15:30'),
    timed('c', '14:15', '15:15'),
    timed('d', '14:30', '15:00'),
    timed('e', '14:30', '15:30'),
    timed('f', '14:45', '15:15'),
  ]
  const segments = () => timedSegments(six, [DAY], 'UTC').get(DAY)!

  it('상한 4면 앞 3열만 4열 폭으로 그리고 나머지 3개는 마지막 칸 "+n" 하나로 묶는다', () => {
    const { visible, more } = capColumns(segments(), 4)
    expect(visible.map((s) => [s.occurrence.scheduleId, s.column, s.columns])).toEqual([
      ['b', 0, 4],
      ['a', 1, 4],
      ['c', 2, 4],
    ])
    expect(more).toHaveLength(1)
    expect(more[0]).toMatchObject({ start: 14 * 60 + 30, column: 3, columns: 4 })
    expect(more[0].hidden.map((s) => s.occurrence.scheduleId).sort()).toEqual(['d', 'e', 'f'])
  })

  it('상한 안이거나 폭을 아직 모르면(상한 0) 그대로', () => {
    expect(capColumns(segments(), 6).more).toEqual([])
    expect(capColumns(segments(), 0).visible).toHaveLength(6)
  })
})

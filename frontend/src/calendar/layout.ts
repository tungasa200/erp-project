// 회차를 보기별 배치로 바꾸는 순수 함수. 시각은 사용자의 현재 시간대로 표시한다(D-40).
import type { Occurrence } from './api'
import { MINUTES_PER_DAY, addDays, diffDays, toZoned } from './time'

/** 블록을 그리는 최소 길이. 15분 일정도 30분 높이로 그려 누르는 영역 24px 기준을 맞춘다(D-76) */
export const MIN_BLOCK_MINUTES = 30

/** 블록이 그려지는 [시작, 끝] 분. 최소 MIN_BLOCK_MINUTES이고, 그날을 넘으면 위로 올린다(23:45 → 23:30) */
export function drawnRange(start: number, end: number): [number, number] {
  const drawnStart = Math.min(start, MINUTES_PER_DAY - MIN_BLOCK_MINUTES)
  return [drawnStart, Math.max(end, drawnStart + MIN_BLOCK_MINUTES)]
}

export interface TimedSegment {
  occurrence: Occurrence
  date: string
  /** 그날 0시부터 분 */
  start: number
  end: number
  /** 겹치는 일정 묶음 안에서의 열 번호와 열 수 (나란히 배치) */
  column: number
  columns: number
  /** 전날부터 이어지거나 다음 날로 넘어가는 조각 */
  continuesBefore: boolean
  continuesAfter: boolean
}

export interface AllDayBar {
  occurrence: Occurrence
  /** 보이는 날짜 범위 안의 첫 칸·칸 수 */
  startIndex: number
  span: number
  row: number
}

/** 종일 일정의 [첫날, 마지막 날], 시간 일정의 [시작 날, 끝나는 날] (사용자 시간대) */
export function occurrenceDates(o: Occurrence, timeZone: string): [string, string] {
  if (o.allDay) return [o.startDate!, o.endDate!]
  const start = toZoned(o.startAt!, timeZone)
  const end = toZoned(o.endAt!, timeZone)
  // 0시에 끝나면 전날까지
  return [start.date, end.minutes === 0 && end.date > start.date ? addDays(end.date, -1) : end.date]
}

/** 하루씩 나눈 시간 일정 조각 (일·주 보기) */
export function timedSegments(occurrences: Occurrence[], days: string[], timeZone: string) {
  const result = new Map<string, TimedSegment[]>(days.map((d) => [d, []]))
  for (const o of occurrences) {
    if (o.allDay) continue
    const s = toZoned(o.startAt!, timeZone)
    const e = toZoned(o.endAt!, timeZone)
    for (const date of days) {
      if (date < s.date || date > e.date) continue
      const start = date === s.date ? s.minutes : 0
      const end = date === e.date ? e.minutes : MINUTES_PER_DAY
      if (end <= start) continue
      result.get(date)!.push({
        occurrence: o,
        date,
        start,
        end,
        column: 0,
        columns: 1,
        continuesBefore: date > s.date,
        continuesAfter: date < e.date && !(e.minutes === 0 && diffDays(date, e.date) === 1),
      })
    }
  }
  for (const segments of result.values()) packColumns(segments)
  return result
}

/** 겹치는 조각끼리 묶어 열을 나눈다. 묶음 안의 열 수는 묶음에서 가장 많이 겹친 수.
 *  겹침은 그려지는 범위(drawnRange)로 판단해 이어진 짧은 블록은 나란히 놓는다 */
function packColumns(segments: TimedSegment[]) {
  const drawnStart = (s: TimedSegment) => drawnRange(s.start, s.end)[0]
  const drawnEnd = (s: TimedSegment) => drawnRange(s.start, s.end)[1]
  segments.sort((a, b) => drawnStart(a) - drawnStart(b) || b.end - a.end)
  let cluster: TimedSegment[] = []
  let clusterEnd = -1
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((s) => s.column + 1))
    for (const s of cluster) s.columns = columns
    cluster = []
  }
  for (const seg of segments) {
    if (drawnStart(seg) >= clusterEnd) flush()
    const used = new Set(cluster.filter((s) => drawnEnd(s) > drawnStart(seg)).map((s) => s.column))
    let column = 0
    while (used.has(column)) column++
    seg.column = column
    cluster.push(seg)
    clusterEnd = Math.max(clusterEnd, drawnEnd(seg))
  }
  flush()
}

/** 종일 행의 막대 (일·주 보기). 줄은 앞에서부터 빈 줄에 넣는다 */
export function allDayBars(occurrences: Occurrence[], days: string[]): AllDayBar[] {
  const first = days[0]
  const last = days[days.length - 1]
  const bars: AllDayBar[] = []
  const rowsEnd: number[] = []
  const items = occurrences
    .filter((o) => o.allDay && o.startDate! <= last && o.endDate! >= first)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!) || b.endDate!.localeCompare(a.endDate!))
  for (const o of items) {
    const startIndex = Math.max(0, diffDays(first, o.startDate!))
    const endIndex = Math.min(days.length - 1, diffDays(first, o.endDate!))
    let row = rowsEnd.findIndex((end) => end < startIndex)
    if (row < 0) row = rowsEnd.length
    rowsEnd[row] = endIndex
    bars.push({ occurrence: o, startIndex, span: endIndex - startIndex + 1, row })
  }
  return bars
}

/** 날짜별 회차 (월·목록 보기). 종일 → 시간순 */
export function occurrencesByDate(occurrences: Occurrence[], days: string[], timeZone: string) {
  const result = new Map<string, Occurrence[]>(days.map((d) => [d, []]))
  for (const o of occurrences) {
    const [from, to] = occurrenceDates(o, timeZone)
    for (const date of days) if (date >= from && date <= to) result.get(date)!.push(o)
  }
  for (const list of result.values())
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startAt ?? '').localeCompare(b.startAt ?? ''))
  return result
}

/** 겹친 일정 블록 한 열의 최소 폭: 제목 한 줄이 읽히는 폭(UX-CAL-171, 이전 28px은 글자 1~2자) */
export const MIN_BLOCK_PX = 56
/** 상한을 넘었을 때 오른쪽에 떼어 두는 "+n" 자리 폭 */
export const MORE_PX = 28

export interface MoreGroup {
  /** 그려지는 범위(분)의 시작 */
  start: number
  /** 상한을 넘어 "+n"으로 묶인 조각 */
  hidden: TimedSegment[]
  /** 보이는 블록이 없어 "+n"이 칸 폭 전체를 쓴다(좁은 칸, UX-CAL-172) */
  full: boolean
}

/** 상한을 넘은 묶음의 보이는 블록. 오른쪽 MORE_PX를 "+n" 자리로 뺀 폭을 열 수로 나눈다 */
export type CappedSegment = TimedSegment & { reserve?: number }

/**
 * 날짜 칸 폭(px)에 겹친 열이 다 들어가지 않으면(열 폭 < MIN_BLOCK_PX) 앞 열만 그리고 나머지는 "+n"으로 묶는다(CAL-70, X-07 A).
 * 보이는 블록은 칸 폭에서 "+n" 자리(MORE_PX)를 뺀 곳에 MIN_BLOCK_PX 이상으로 놓는다. 그 자리도 없으면(390 주 보기 40px)
 * 겹친 묶음은 통째로 칸 폭 "+n" 하나가 된다(UX-CAL-172). 폭을 아직 모르면(0, jsdom) 그대로 둔다
 */
export function capColumns(segments: TimedSegment[], width: number): { visible: CappedSegment[]; more: MoreGroup[] } {
  const fit = Math.max(1, Math.floor(width / MIN_BLOCK_PX))
  if (!width || segments.every((s) => s.columns <= fit)) return { visible: segments, more: [] }
  const keep = Math.max(0, Math.floor((width - MORE_PX) / MIN_BLOCK_PX))
  const visible: CappedSegment[] = []
  const hidden: TimedSegment[] = []
  for (const s of segments) {
    if (s.columns <= fit) visible.push(s)
    else if (s.column < keep) visible.push({ ...s, columns: keep, reserve: MORE_PX })
    else hidden.push(s)
  }
  hidden.sort((a, b) => drawnRange(a.start, a.end)[0] - drawnRange(b.start, b.end)[0])
  const more: MoreGroup[] = []
  let end = -1
  for (const s of hidden) {
    const [from, to] = drawnRange(s.start, s.end)
    const last = more[more.length - 1]
    if (last && from < end) {
      last.hidden.push(s)
      end = Math.max(end, to)
    } else {
      more.push({ start: from, hidden: [s], full: keep === 0 })
      end = to
    }
  }
  return { visible, more }
}

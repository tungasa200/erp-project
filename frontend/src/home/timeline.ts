// SCR-HOME-01 ③ 오늘 일정 타임라인(P2-08, SCH-05)이 쓰는 데이터와 순수 계산.
// 계획 = 오늘 일정 회차, 실제 = 오늘(workDate) 기록. 회차와 기록은 (scheduleId, occurrenceStart)로 잇는다(D-100).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import type { Occurrence } from '../calendar/api'
import { MINUTES_PER_DAY, toZoned } from '../calendar/time'
import type { WorkRecord } from '../records/api'

/** 그날 기록 전체(확인 대기·하지 않음 포함 — 계획 블록의 상태로 그린다) */
export function useRecordsOn(date: string) {
  return useQuery({
    queryKey: ['records', 'on', date],
    queryFn: () => api.request<components['schemas']['WorkRecordList']>(`/api/worklog/records?from=${date}&to=${date}`),
    select: (d) => d.items,
  })
}

export type PlanPhase = 'upcoming' | 'now' | 'ended'

export interface PlanEntry {
  key: string
  occurrence: Occurrence
  /** 이 회차에서 만든 기록(끝난 뒤 확인 대기로 생긴다). 아직 없으면 undefined */
  record: WorkRecord | undefined
  phase: PlanPhase
  /** 오늘 0시부터 분. 종일은 0~1440 */
  start: number
  end: number
}

const linkKey = (scheduleId: string | null | undefined, occurrenceStart: string | null | undefined) =>
  scheduleId && occurrenceStart ? `${scheduleId}|${Date.parse(occurrenceStart)}` : ''

/** 오늘 계획 회차(종일 → 시간순)에 기록과 지금 상태를 붙인다. 보관한 기록은 뺀다 */
export function planEntries(
  occurrences: Occurrence[],
  records: WorkRecord[],
  today: string,
  timeZone: string,
  now: number,
): PlanEntry[] {
  const byLink = new Map<string, WorkRecord>()
  for (const r of records) if (!r.deletedAt) byLink.set(linkKey(r.scheduleId, r.occurrenceStart), r)
  return occurrences.map((o) => {
    const [start, end] = minutesOn(o, today, timeZone)
    const endsAt = o.allDay ? null : Date.parse(o.endAt!)
    const startsAt = o.allDay ? null : Date.parse(o.startAt!)
    // 종일 일정은 그날이 끝나야 끝난다(오늘 안에서는 '진행 중'으로 보지 않고 예정으로 둔다)
    const phase: PlanPhase =
      endsAt === null ? 'upcoming' : endsAt <= now ? 'ended' : startsAt! <= now ? 'now' : 'upcoming'
    return {
      key: `${o.scheduleId}|${o.occurrenceStart}`,
      occurrence: o,
      record: byLink.get(linkKey(o.scheduleId, o.occurrenceStart)),
      phase,
      start,
      end,
    }
  })
}

function minutesOn(o: Occurrence, date: string, timeZone: string): [number, number] {
  if (o.allDay) return [0, MINUTES_PER_DAY]
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  return [s.date === date ? s.minutes : 0, e.date === date ? e.minutes : MINUTES_PER_DAY]
}

export interface ActualEntry {
  record: WorkRecord
  start: number
  end: number
  /** 실행 중 타이머(startAt만 있음, P2-06) — 지금까지로 그린다 */
  running: boolean
}

/** 시간 기록 옵션의 실제 열: 확정 기록 중 시작 시각이 있는 것. 시간 없이 남긴 직접 기록은 따로 센다
 *  (시간 없는 계획 기록은 계획 열에 ✓로 이미 보여 세지 않는다) */
export function actualEntries(records: WorkRecord[], today: string, timeZone: string, now: number) {
  const timed: ActualEntry[] = []
  const untimed: WorkRecord[] = []
  for (const r of records) {
    if (r.deletedAt || r.status !== 'CONFIRMED') continue
    if (!r.startAt) {
      if (!r.scheduleId) untimed.push(r)
      continue
    }
    const s = toZoned(r.startAt, timeZone)
    const e = toZoned(r.endAt ?? now, timeZone)
    const start = s.date === today ? s.minutes : 0
    const end = e.date === today ? e.minutes : e.date > today ? MINUTES_PER_DAY : start
    timed.push({ record: r, start, end: Math.max(end, start), running: !r.endAt })
  }
  timed.sort((a, b) => a.start - b.start || a.end - b.end)
  return { timed, untimed }
}

/** 그리는 시간 범위(시 단위로 넓힌다). 계획·실제·지금이 모두 들어가고 최소 4시간 */
export function gridRange(spans: { start: number; end: number }[], nowMinutes: number | null): [number, number] {
  const points = spans.flatMap((s) => [s.start, s.end])
  if (nowMinutes !== null) points.push(nowMinutes)
  if (points.length === 0) return [9 * 60, 18 * 60]
  let from = Math.floor(Math.min(...points) / 60) * 60
  let to = Math.ceil(Math.max(...points) / 60) * 60
  if (to - from < 240) {
    to = Math.min(MINUTES_PER_DAY, from + 240)
    from = Math.max(0, to - 240)
  }
  return [from, to]
}

/** 겹치는 블록을 나란히 놓는다(캘린더 일 보기와 같은 방식, 최소 높이를 겹침으로 본다) */
export function packLanes<T extends { start: number; end: number }>(items: T[], minLength: number) {
  const drawnEnd = (x: T) => Math.max(x.end, x.start + minLength)
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const placed: { item: T; lane: number; lanes: number }[] = []
  let cluster: { item: T; lane: number; lanes: number }[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    for (const c of cluster) c.lanes = lanes
    placed.push(...cluster)
    cluster = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => drawnEnd(c.item) > item.start).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ item, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, drawnEnd(item))
  }
  flush()
  return placed
}

// 일정 회차의 기록 상태(화면정의서 2.3) 계산: SCR-CAL-07 ⑥과 SCR-CAL-02 "이날의 기록"이 함께 쓴다(표시는 RecordStatusTag).
// 회차와 기록은 (scheduleId, occurrenceStart)로 잇는다(D-100).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import { durationText } from '../home/gaps'
import type { WorkRecord } from '../records/api'
import type { Occurrence } from './api'
import { formatMinutes, todayIn, toZoned } from './time'

/** 기록의 시간: 시작~종료, 실행 중이면 "시작~ 진행 중", 시작이 없으면 소요시간. 아무것도 없으면 null */
export function recordTimeText(r: WorkRecord, timeZone: string): string | null {
  if (r.startAt) {
    const s = formatMinutes(toZoned(r.startAt, timeZone).minutes)
    if (!r.endAt) return `${s}~ 진행 중`
    const e = toZoned(r.endAt, timeZone)
    const nextDay = e.date !== toZoned(r.startAt, timeZone).date ? '다음 날 ' : ''
    return `${s}–${nextDay}${formatMinutes(e.minutes)}`
  }
  return r.durationMin ? durationText(r.durationMin) : null
}

const sameOccurrence = (r: WorkRecord, o: Pick<Occurrence, 'scheduleId' | 'occurrenceStart'>) =>
  r.scheduleId === o.scheduleId &&
  !!r.occurrenceStart &&
  Date.parse(r.occurrenceStart) === Date.parse(o.occurrenceStart)

/** 회차에서 만든 기록(보관한 기록은 뺀다) */
export function recordOf(records: WorkRecord[], o: Pick<Occurrence, 'scheduleId' | 'occurrenceStart'>) {
  return records.find((r) => !r.deletedAt && sameOccurrence(r, o))
}

/** 기록에 이어진 회차(확인 대기 수정 창에 계획 시각을 채우는 데 쓴다) */
export function occurrenceOf(occurrences: Occurrence[], r: WorkRecord) {
  return r.scheduleId && r.occurrenceStart ? occurrences.find((o) => sameOccurrence(r, o)) : undefined
}

/**
 * 계획 회차가 끝났는지. 확인 대기는 끝난 회차만 보인다(D-31, 홈 오늘 타임라인 planEntries와 같은 기준).
 * 종일은 마지막 날이 지나야 끝난다. 회차를 모르면(보이는 기간 밖·7일 넘음) 끝난 것으로 본다
 */
export function planEnded(
  plan: Pick<Occurrence, 'allDay' | 'endAt' | 'startDate' | 'endDate'> | undefined,
  now: number,
  timeZone: string,
): boolean {
  if (!plan) return true
  if (plan.allDay) {
    const last = plan.endDate ?? plan.startDate
    return !last || last < todayIn(timeZone, now)
  }
  return !plan.endAt || Date.parse(plan.endAt) <= now
}

/** 시간 일정이면 확인 대기 수정 창에 채울 계획 시각(RecordDialog planned). 회차를 그대로 넘긴다 */
export { plannedOf } from '../records/pending'

/**
 * 그날(workDate) 기록 전체 — 세 상태 모두. from=to면 서버가 그날 끝난 회차의 확인 대기를 먼저 만든다(D-39).
 * 홈 타임라인 useRecordsOn(home/timeline.ts)과 같은 키·요청이라 캐시를 함께 쓴다. 여기는 새 일정 창처럼 날짜가 없을 때 끄는 enabled가 있다
 */
export function useRecordsOnDate(date: string, enabled = true) {
  return useQuery({
    queryKey: ['records', 'on', date],
    queryFn: () => api.request<components['schemas']['WorkRecordList']>(`/api/worklog/records?from=${date}&to=${date}`),
    enabled: enabled && !!date,
    select: (d) => d.items,
  })
}

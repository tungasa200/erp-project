// 일정 옮기기·길이 조절·삭제. 확인창 없이 바로 실행하고 되돌리기 토스트를 띄운다(UX-03).
// 반복 일정은 먼저 범위(이 일정만 / 모든 일정)를 묻는다(SCR-CAL-08).
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { OCCURRENCES_QUERY_KEY, occurrenceKey, scheduleApi, type Occurrence, type Schedule } from './api'
import { restoreFocus } from './focus'
import { WEEKDAYS, addDays, diffDays, fromZoned, toZoned, type Weekday } from './time'

export type Scope = 'this' | 'all'
export type ScopeAction = 'move' | 'delete' | 'edit' | 'editSeries'

/** 회차의 새 시각. 일정 종류에 맞는 칸만 */
export type TimeChange = { startAt: string; endAt: string } | { startDate: string; endDate: string }

export type AskScope = (occurrence: Occurrence, action: ScopeAction) => Promise<Scope | null>

const CONFLICT_MESSAGE = '다른 곳에서 먼저 수정돼서 새로 불러왔어요. 다시 해 주세요'

/** 일정 원본을 회차 변화만큼 옮긴다("모든 일정"). 매주 반복은 요일도 같은 날 수만큼 옮긴다 */
export function shiftSchedule(schedule: Schedule, occurrence: Occurrence, change: TimeChange) {
  if ('startDate' in change) {
    const startShift = diffDays(occurrence.startDate!, change.startDate)
    const endShift = diffDays(occurrence.endDate!, change.endDate)
    const startDate = addDays(schedule.startDate!, startShift)
    return {
      startDate,
      endDate: addDays(schedule.endDate!, endShift),
      recurrence: shiftWeekdays(schedule, startShift),
    }
  }
  const startDelta = Date.parse(change.startAt) - Date.parse(occurrence.startAt!)
  const endDelta = Date.parse(change.endAt) - Date.parse(occurrence.endAt!)
  const startAt = new Date(Date.parse(schedule.startAt!) + startDelta).toISOString()
  const dayShift = diffDays(
    toZoned(schedule.startAt!, schedule.timezone).date,
    toZoned(startAt, schedule.timezone).date,
  )
  return {
    startAt,
    endAt: new Date(Date.parse(schedule.endAt!) + endDelta).toISOString(),
    recurrence: shiftWeekdays(schedule, dayShift),
  }
}

function shiftWeekdays(schedule: Schedule, days: number) {
  const r = schedule.recurrence
  if (!r || r.frequency !== 'WEEKLY' || days % 7 === 0) return r
  const weekdays = (r.weekdays ?? []).map((w: Weekday) => WEEKDAYS[(((WEEKDAYS.indexOf(w) + days) % 7) + 7) % 7])
  return { ...r, weekdays }
}

/** 회차를 날짜만 옮긴다. 시간 일정은 같은 벽시계 시각(사용자 시간대)을 유지한다 */
export function shiftByDays(o: Occurrence, days: number, timeZone: string): TimeChange {
  if (o.allDay) return { startDate: addDays(o.startDate!, days), endDate: addDays(o.endDate!, days) }
  const s = toZoned(o.startAt!, timeZone)
  const startAt = fromZoned(addDays(s.date, days), s.minutes, timeZone)
  const duration = Date.parse(o.endAt!) - Date.parse(o.startAt!)
  return { startAt, endAt: new Date(Date.parse(startAt) + duration).toISOString() }
}

function timeFields(o: Occurrence): TimeChange {
  return o.allDay ? { startDate: o.startDate!, endDate: o.endDate! } : { startAt: o.startAt!, endAt: o.endAt! }
}

export function useScheduleActions(askScope: AskScope) {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  // 지연 삭제 중인 회차·일정. 토스트가 닫히기 전에 다시 불러와도 화면에 돌아오지 않게 거른다(D-72)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: OCCURRENCES_QUERY_KEY }),
    [queryClient],
  )

  const failed = useCallback(
    (error: unknown) => {
      void invalidate()
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') showToast(CONFLICT_MESSAGE)
      else {
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
    },
    [invalidate, showToast],
  )

  /** 다시 불러오기 전에 화면부터 옮겨 둔다 */
  const patchCache = useCallback(
    (key: string, change: Partial<Occurrence>) =>
      queryClient.setQueriesData<Occurrence[]>({ queryKey: OCCURRENCES_QUERY_KEY }, (list) =>
        list?.map((o) => (occurrenceKey(o) === key ? { ...o, ...change } : o)),
      ),
    [queryClient],
  )

  const move = useCallback(
    async (o: Occurrence, change: TimeChange) => {
      const before = timeFields(o)
      const scope: Scope | null = o.recurring ? await askScope(o, 'move') : 'this'
      if (!scope) return
      patchCache(occurrenceKey(o), change)
      try {
        if (!o.recurring) {
          const saved = await scheduleApi.update(o.scheduleId, { version: o.version, ...change })
          void invalidate()
          showUndo({
            group: 'schedule-move',
            message: () => '일정을 옮겼어요',
            undo: () =>
              scheduleApi.update(o.scheduleId, { version: saved.version, ...before }).then(invalidate, failed),
          })
        } else if (scope === 'this') {
          const saved = await scheduleApi.updateOccurrence(o.scheduleId, o.occurrenceStart, {
            version: o.version,
            ...change,
          })
          void invalidate()
          showUndo({
            group: 'schedule-move',
            message: () => '이 일정만 옮겼어요',
            undo: () =>
              scheduleApi
                .updateOccurrence(o.scheduleId, o.occurrenceStart, { version: saved.version, ...before })
                .then(invalidate, failed),
          })
        } else {
          const schedule = await scheduleApi.get(o.scheduleId)
          const original = schedule.allDay
            ? { startDate: schedule.startDate, endDate: schedule.endDate, recurrence: schedule.recurrence }
            : { startAt: schedule.startAt, endAt: schedule.endAt, recurrence: schedule.recurrence }
          const saved = await scheduleApi.update(o.scheduleId, {
            version: schedule.version,
            ...shiftSchedule(schedule, o, change),
          })
          void invalidate()
          // 시각을 바꾸면 서버가 회차별 변경을 지우므로 되돌려도 원래 시각만 돌아온다(D-71)
          showUndo({
            group: 'schedule-move',
            message: () => '모든 일정을 옮겼어요',
            undo: () =>
              scheduleApi.update(o.scheduleId, { version: saved.version, ...original }).then(invalidate, failed),
          })
        }
      } catch (error) {
        failed(error)
      }
    },
    [askScope, failed, invalidate, patchCache, showUndo],
  )

  const remove = useCallback(
    async (o: Occurrence) => {
      const scope: Scope | null = o.recurring ? await askScope(o, 'delete') : 'all'
      if (!scope) return
      const hideKey = scope === 'all' ? o.scheduleId : occurrenceKey(o)
      setHidden((prev) => new Set(prev).add(hideKey))
      // 지운 블록에 있던 포커스가 body로 빠지면 캘린더 제목으로(P1-07-18, P1-06-04). 대화상자 두 겹(상세 → 범위)을
      // 거치면 브라우저에 따라 useFocusRescue가 못 받는 경우가 있어, 블록이 사라진 다음 프레임에 한 번 더 확인한다
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) restoreFocus(null)
      })
      const show = () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(hideKey)
          return next
        })
      showUndo({
        group: 'schedule-delete',
        message: (count) => (count > 1 ? `일정 ${count}개를 삭제했어요` : '일정을 삭제했어요'),
        undo: show,
        // 토스트가 닫힐 때, 또는 새로고침·탭 닫기(keepalive) 때 실제로 삭제한다
        commit: ({ keepalive }) => {
          const request =
            scope === 'all'
              ? scheduleApi.remove(o.scheduleId, { keepalive })
              : scheduleApi.removeOccurrence(o.scheduleId, o.occurrenceStart, { keepalive })
          request.then(
            () => invalidate().then(show),
            (error) => {
              show()
              failed(error)
            },
          )
        },
      })
    },
    [askScope, failed, invalidate, showUndo],
  )

  const visible = useCallback(
    (list: Occurrence[]) =>
      hidden.size ? list.filter((o) => !hidden.has(o.scheduleId) && !hidden.has(occurrenceKey(o))) : list,
    [hidden],
  )

  return { move, remove, visible, failed, invalidate }
}

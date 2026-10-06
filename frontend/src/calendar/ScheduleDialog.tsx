// 일정 상세·편집 (SCR-CAL-07). 새로 만들 때와 고칠 때 같은 모달을 쓴다. 저장 버튼이 있는 모달이다.
// 반복 일정은 저장·삭제할 때 범위를 묻는다(SCR-CAL-08). 종일 여부·반복 규칙을 바꾸면 "모든 일정"만 가능하다(계약 OccurrencePatch).
// ④ 연결 업무는 TaskLinkField(P1-05-06, 반복 일정은 시리즈 전체에 연결 D-71). ⑥ 기록 상태는 P2라 아직 없다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { TASKS_QUERY_KEY } from '../tasks/api'
import { occurrenceFocusId } from './focus'
import { Modal } from './Modal'
import { TaskLinkField } from './TaskLinkField'
import {
  OCCURRENCES_QUERY_KEY,
  scheduleApi,
  useInvalidateOccurrences,
  type Occurrence,
  type Recurrence,
  type Schedule,
  type ScheduleCreate,
  type SchedulePatch,
} from './api'
import type { ScheduleDraft } from './QuickCreate'
import { shiftSchedule, type AskScope, type TimeChange } from './useScheduleActions'
import {
  MINUTES_PER_DAY,
  WEEKDAYS,
  WEEKDAY_LABELS,
  addDays,
  diffDays,
  formatMinutes,
  fromZoned,
  toZoned,
  weekdayIndex,
  type Weekday,
} from './time'
import styles from './calendar.module.css'

type Frequency = Recurrence['frequency'] | 'NONE'
type EndKind = 'never' | 'until' | 'count'

interface Form {
  title: string
  allDay: boolean
  date: string
  endDate: string
  start: string
  end: string
  frequency: Frequency
  weekdays: Weekday[]
  /** 사용자가 직접 고른(또는 저장된) 요일. 시작일을 바꿀 때 이전 시작일의 요일은 여기 없으면 뺀다(P1-06-02) */
  pickedWeekdays: Weekday[]
  endKind: EndKind
  until: string
  count: string
  memo: string
  taskId: string | null
}

type TimeField = 'date' | 'endDate' | 'start' | 'end'
type RecurrenceField = 'frequency' | 'weekdays' | 'until' | 'count'
/** 칸별 오류(2.5). 문구는 묶음별 하나, *At은 그 문구가 가리키는 칸 */
type Errors = Partial<Record<'title' | 'time' | 'recurrence', string>> & {
  timeAt?: TimeField
  recurrenceAt?: RecurrenceField
}

interface Props {
  timeZone: string
  /** 새 일정이면 draft, 고칠 때는 occurrence */
  draft?: ScheduleDraft
  occurrence?: Occurrence
  askScope: AskScope
  onDelete: (o: Occurrence) => void
  onClose: () => void
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'NONE', label: '없음' },
  { value: 'DAILY', label: '매일' },
  { value: 'WEEKLY', label: '매주' },
  { value: 'MONTHLY', label: '매월' },
]

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formFromDraft(d: ScheduleDraft): Form {
  return {
    title: d.title,
    allDay: d.allDay,
    date: d.date,
    endDate: d.date,
    start: formatMinutes(d.start),
    end: formatMinutes(Math.min(d.end, MINUTES_PER_DAY - 1)),
    frequency: 'NONE',
    weekdays: [WEEKDAYS[weekdayIndex(d.date)]],
    pickedWeekdays: [],
    endKind: 'never',
    until: '',
    count: '',
    memo: '',
    taskId: d.taskId ?? null,
  }
}

function formFromOccurrence(o: Occurrence, schedule: Schedule | undefined, timeZone: string): Form {
  const r = schedule?.recurrence
  const s = o.allDay ? null : toZoned(o.startAt!, timeZone)
  const e = o.allDay ? null : toZoned(o.endAt!, timeZone)
  const date = o.allDay ? o.startDate! : s!.date
  return {
    title: o.title,
    allDay: o.allDay,
    date,
    endDate: o.allDay ? o.endDate! : date,
    start: s ? formatMinutes(s.minutes) : '09:00',
    end: e ? formatMinutes(e.date > s!.date && e.minutes === 0 ? MINUTES_PER_DAY - 1 : e.minutes) : '10:00',
    frequency: r?.frequency ?? 'NONE',
    weekdays: r?.weekdays?.length ? r.weekdays : [WEEKDAYS[weekdayIndex(date)]],
    pickedWeekdays: r?.weekdays ?? [],
    endKind: r?.until ? 'until' : r?.count ? 'count' : 'never',
    until: r?.until ?? '',
    count: r?.count ? String(r.count) : '',
    memo: o.memo ?? '',
    taskId: o.taskId ?? null,
  }
}

function recurrenceOf(f: Form): Recurrence | null {
  if (f.frequency === 'NONE') return null
  return {
    frequency: f.frequency,
    ...(f.frequency === 'WEEKLY' && { weekdays: WEEKDAYS.filter((w) => f.weekdays.includes(w)) }),
    until: f.endKind === 'until' ? f.until : null,
    count: f.endKind === 'count' ? Number(f.count) : null,
  }
}

function timeOf(f: Form, timeZone: string): TimeChange {
  if (f.allDay) return { startDate: f.date, endDate: f.endDate }
  return {
    startAt: fromZoned(f.date, toMinutes(f.start), timeZone),
    endAt: fromZoned(f.date, toMinutes(f.end), timeZone),
  }
}

function validate(f: Form): Errors {
  const errors: Errors = {}
  const time = (message: string, at: TimeField) => Object.assign(errors, { time: message, timeAt: at })
  const recurrence = (message: string, at: RecurrenceField) =>
    Object.assign(errors, { recurrence: message, recurrenceAt: at })
  if (!f.title.trim()) errors.title = '일정 이름을 적어 주세요'
  if (!f.date) time('날짜를 골라 주세요', 'date')
  else if (f.allDay && f.endDate < f.date) time('끝나는 날을 시작일과 같거나 뒤로 골라 주세요', 'endDate')
  else if (!f.allDay && !f.start) time('시작 시각을 골라 주세요', 'start')
  else if (!f.allDay && (!f.end || toMinutes(f.end) <= toMinutes(f.start)))
    time('끝나는 시각을 시작보다 뒤로 골라 주세요', 'end')
  if (f.frequency === 'WEEKLY' && f.date && !f.weekdays.includes(WEEKDAYS[weekdayIndex(f.date)]))
    recurrence(`시작일의 요일(${WEEKDAY_LABELS[weekdayIndex(f.date)]})을 포함해 주세요`, 'weekdays')
  if (f.frequency !== 'NONE' && f.endKind === 'until' && (!f.until || f.until < f.date))
    recurrence('반복 종료일을 시작일 뒤로 골라 주세요', 'until')
  if (f.frequency !== 'NONE' && f.endKind === 'count' && !(Number(f.count) >= 1 && Number(f.count) <= 999))
    recurrence('반복 횟수는 1~999 사이로 적어 주세요', 'count')
  return errors
}

/** 서버의 칸별 오류(errors[])를 화면 칸으로 옮긴다(2.5) */
function serverErrors(error: ApiError): Errors | null {
  const list = error.problem?.errors
  if (!list?.length) return null
  const result: Errors = {}
  const timeFields: Record<string, TimeField> = {
    startAt: 'start',
    endAt: 'end',
    startDate: 'date',
    endDate: 'endDate',
  }
  const recurrenceFields: Record<string, RecurrenceField> = {
    'recurrence.weekdays': 'weekdays',
    'recurrence.until': 'until',
    'recurrence.count': 'count',
  }
  for (const e of list) {
    if (e.field === 'title') result.title = '일정 이름을 확인해 주세요'
    else if (e.field.startsWith('recurrence')) {
      result.recurrence ??= '반복 설정을 확인해 주세요'
      result.recurrenceAt ??= recurrenceFields[e.field] ?? 'frequency'
    } else {
      result.time ??= '시간을 확인해 주세요'
      result.timeAt ??= timeFields[e.field] ?? 'date'
    }
  }
  return result
}

export function ScheduleDialog({ timeZone, draft, occurrence, askScope, onDelete, onClose }: Props) {
  const id = useId()
  const { showToast } = useToast()
  const invalidate = useInvalidateOccurrences()
  const queryClient = useQueryClient()
  const schedule = useQuery({
    queryKey: ['schedule', occurrence?.scheduleId],
    queryFn: () => scheduleApi.get(occurrence!.scheduleId),
    enabled: !!occurrence,
    gcTime: 0,
  })
  const [form, setForm] = useState<Form | null>(draft ? formFromDraft(draft) : null)
  const [errors, setErrors] = useState<Errors>({})
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  // 연 회차. [새로 불러오기] 뒤에는 서버의 최신 회차로 바꾼다(제목·시각·메모는 회차 값이라, P1-05-05)
  const [latest, setLatest] = useState(occurrence)
  const formRef = useRef<HTMLFormElement>(null)
  // 저장이 칸 오류로 막히면 첫 오류 칸으로 포커스(2.5, P1-05-03)
  const [errorFocus, setErrorFocus] = useState(0)
  useEffect(() => {
    if (errorFocus) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid] button')?.focus()
  }, [errorFocus])
  const showErrors = (found: Errors) => {
    setErrors(found)
    setErrorFocus((n) => n + 1)
  }

  // 고칠 때는 원본(반복 규칙)을 받은 뒤 채운다
  const current = form ?? (latest && schedule.data ? formFromOccurrence(latest, schedule.data, timeZone) : null)
  const update = (patch: Partial<Form>) => {
    setForm({ ...current!, ...patch })
    setErrors({})
  }

  const failed = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return setConflict(true)
    const fields = error instanceof ApiError ? serverErrors(error) : null
    if (fields) return showErrors(fields)
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const reload = async () => {
    setConflict(false)
    setForm(null)
    setErrors({})
    const startedAt = Date.now()
    await Promise.all([schedule.refetch(), invalidate()])
    const key = latest && occurrenceFocusId(latest)
    // 이번에 다시 받은 기간에서만 찾는다. 안 쓰는 기간의 캐시(다시 받지 않음)에는 옛 값이 남아 있다
    const fresh = queryClient
      .getQueryCache()
      .findAll({ queryKey: OCCURRENCES_QUERY_KEY })
      .filter((q) => q.state.dataUpdatedAt >= startedAt)
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .flatMap((q) => (Array.isArray(q.state.data) ? (q.state.data as Occurrence[]) : []))
      .find((o) => occurrenceFocusId(o) === key)
    if (fresh) setLatest(fresh)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || saving) return
    const found = validate(current)
    if (Object.keys(found).length) return showErrors(found)
    setSaving(true)
    try {
      if (!latest) await create(current)
      else if (!(await save(latest, schedule.data!, current))) return
      void invalidate()
      onClose()
    } catch (error) {
      failed(error)
    } finally {
      setSaving(false)
    }
  }

  const create = async (f: Form) => {
    const body: ScheduleCreate = {
      title: f.title.trim(),
      allDay: f.allDay,
      ...timeOf(f, timeZone),
      recurrence: recurrenceOf(f),
      memo: f.memo.trim() || null,
      taskId: f.taskId,
    }
    await scheduleApi.create(body)
    // 업무 패널에서 연 일정이면 그 업무가 패널(일정 없는 업무)에서 빠진다
    if (body.taskId) void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    showToast('일정을 만들었어요')
  }

  /** 저장했으면 true, 범위 선택을 취소했으면 false */
  const save = async (o: Occurrence, s: Schedule, f: Form) => {
    const before = formFromOccurrence(o, s, timeZone)
    const title = f.title.trim()
    const memo = f.memo.trim() || null
    const timeChanged =
      f.allDay === before.allDay &&
      (f.date !== before.date ||
        f.endDate !== before.endDate ||
        (!f.allDay && (f.start !== before.start || f.end !== before.end)))
    const kindChanged = f.allDay !== before.allDay
    const recurrenceChanged = JSON.stringify(recurrenceOf(f)) !== JSON.stringify(recurrenceOf(before))
    const textPatch = {
      ...(title !== o.title && { title }),
      ...(memo !== (o.memo ?? null) && { memo }),
    }
    const taskChanged = f.taskId !== before.taskId
    const otherChanged = timeChanged || kindChanged || recurrenceChanged || Object.keys(textPatch).length > 0
    if (!otherChanged && !taskChanged) return true
    // 연결이 바뀌면 업무 패널(일정 없는 업무)·회차 색(프로젝트, D-73)이 바뀐다
    if (taskChanged) void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })

    // 반복 일정의 업무 연결은 시리즈 전체에만 한다(D-71). 연결만 바꾸면 범위를 묻지 않는다
    if (o.recurring && otherChanged) {
      const scope = await askScope(o, kindChanged || recurrenceChanged ? 'editSeries' : 'edit')
      if (!scope) return false
      if (scope === 'this') {
        const updated = await scheduleApi.updateOccurrence(o.scheduleId, o.occurrenceStart, {
          version: o.version,
          ...textPatch,
          ...(timeChanged && timeOf(f, timeZone)),
        })
        if (taskChanged) {
          // 회차 변경이 version을 올렸으므로 그 응답의 version으로 시리즈에 연결한다
          try {
            await scheduleApi.update(o.scheduleId, { version: updated.version, taskId: f.taskId })
          } catch (error) {
            // 회차만 바뀌고 연결은 실패: 화면을 서버 값으로 맞추고 알린다
            await reload()
            const { message, traceId } = toastForError(error)
            showToast(`이 일정은 바꿨지만 업무 연결은 저장하지 못했어요. ${message}`, { traceId })
            return false
          }
        }
        showToast('이 일정만 바꿨어요')
        return true
      }
    }
    const patch: SchedulePatch = { version: s.version, ...textPatch, ...(taskChanged && { taskId: f.taskId }) }
    if (kindChanged) Object.assign(patch, { allDay: f.allDay, ...timeOf(f, timeZone) })
    else if (timeChanged)
      Object.assign(patch, o.recurring ? shiftSchedule(s, o, timeOf(f, timeZone)) : timeOf(f, timeZone))
    if (recurrenceChanged) patch.recurrence = recurrenceOf(f)
    await scheduleApi.update(o.scheduleId, patch)
    showToast(o.recurring ? '모든 일정을 바꿨어요' : '일정을 저장했어요')
    return true
  }

  const title = occurrence ? '일정 편집' : '새 일정'
  /** 오류 문구가 가리키는 칸이면 aria-invalid와 문구 연결 */
  const invalid = (group: 'time' | 'recurrence', at: TimeField | RecurrenceField) =>
    errors[`${group}At`] === at ? { 'aria-invalid': true, 'aria-describedby': `${id}-${group}-error` } : {}

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose}>
      <div className={styles.dialogHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      {conflict && (
        <div className={styles.conflict} role="alert">
          <span style={{ flex: 1 }}>다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요</span>
          <button type="button" className={styles.secondary} onClick={() => void reload()}>
            새로 불러오기
          </button>
        </div>
      )}
      {!current ? (
        schedule.isError ? (
          <p className={styles.muted}>일정을 불러오지 못했어요. 이미 삭제됐을 수 있어요</p>
        ) : (
          <Skeleton shape="lines" count={4} />
        )
      ) : (
        <form ref={formRef} className={styles.fieldset} onSubmit={(e) => void submit(e)} noValidate>
          <label className={styles.field}>
            제목
            <input
              className={styles.input}
              value={current.title}
              maxLength={200}
              onChange={(e) => update({ title: e.target.value })}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? `${id}-title-error` : undefined}
            />
          </label>
          {errors.title && (
            <p id={`${id}-title-error`} role="alert" className={styles.fieldError}>
              {errors.title}
            </p>
          )}

          <div className={styles.row}>
            <label className={styles.field}>
              {current.allDay ? '시작일' : '날짜'}
              <input
                type="date"
                className={styles.input}
                value={current.date}
                {...invalid('time', 'date')}
                onChange={(e) => {
                  const date = e.target.value
                  if (!date) return update({ date })
                  // 종일 일정은 기간을 유지한다. 매주 반복은 새 시작 요일을 넣고, 이전 시작 요일은 직접 고른 게 아니면 뺀다
                  const weekday = WEEKDAYS[weekdayIndex(date)]
                  const previous = current.date ? WEEKDAYS[weekdayIndex(current.date)] : null
                  const kept = current.weekdays.filter((w) => w !== previous || current.pickedWeekdays.includes(w))
                  update({
                    date,
                    endDate:
                      current.allDay && current.date
                        ? addDays(date, Math.max(0, diffDays(current.date, current.endDate)))
                        : date,
                    weekdays: kept.includes(weekday) ? kept : [...kept, weekday],
                  })
                }}
              />
            </label>
            {current.allDay ? (
              <label className={styles.field}>
                종료일
                <input
                  type="date"
                  className={styles.input}
                  value={current.endDate}
                  min={current.date}
                  {...invalid('time', 'endDate')}
                  onChange={(e) => update({ endDate: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label className={styles.field}>
                  시작
                  <input
                    type="time"
                    step={900}
                    className={styles.input}
                    value={current.start}
                    {...invalid('time', 'start')}
                    onChange={(e) => update({ start: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  종료
                  <input
                    type="time"
                    step={900}
                    className={styles.input}
                    value={current.end}
                    {...invalid('time', 'end')}
                    onChange={(e) => update({ end: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          {errors.time && (
            <p id={`${id}-time-error`} role="alert" className={styles.fieldError}>
              {errors.time}
            </p>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={current.allDay}
              onChange={(e) => update({ allDay: e.target.checked, endDate: current.date })}
            />
            종일
          </label>

          <fieldset className={styles.fieldset}>
            <legend>반복</legend>
            <div
              className={styles.segment}
              role="group"
              aria-label="반복 주기"
              data-invalid={errors.recurrenceAt === 'frequency' || undefined}
              aria-describedby={errors.recurrenceAt === 'frequency' ? `${id}-recurrence-error` : undefined}
            >
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={current.frequency === f.value}
                  onClick={() => update({ frequency: f.value })}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {current.frequency === 'WEEKLY' && (
              <div
                className={styles.segment}
                role="group"
                aria-label="반복 요일"
                data-invalid={errors.recurrenceAt === 'weekdays' || undefined}
                aria-describedby={errors.recurrenceAt === 'weekdays' ? `${id}-recurrence-error` : undefined}
              >
                {[1, 2, 3, 4, 5, 6, 0].map((i) => {
                  const w = WEEKDAYS[i]
                  const on = current.weekdays.includes(w)
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        update(
                          on
                            ? {
                                weekdays: current.weekdays.filter((x) => x !== w),
                                pickedWeekdays: current.pickedWeekdays.filter((x) => x !== w),
                              }
                            : { weekdays: [...current.weekdays, w], pickedWeekdays: [...current.pickedWeekdays, w] },
                        )
                      }
                    >
                      {WEEKDAY_LABELS[i]}
                    </button>
                  )
                })}
              </div>
            )}
            {current.frequency !== 'NONE' && (
              <div className={styles.row} role="radiogroup" aria-label="반복 종료">
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={`${id}-end`}
                    checked={current.endKind === 'never'}
                    onChange={() => update({ endKind: 'never' })}
                  />
                  종료 없음
                </label>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={`${id}-end`}
                    checked={current.endKind === 'until'}
                    onChange={() => update({ endKind: 'until' })}
                  />
                  날짜까지
                </label>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={`${id}-end`}
                    checked={current.endKind === 'count'}
                    onChange={() => update({ endKind: 'count' })}
                  />
                  횟수
                </label>
              </div>
            )}
            {current.frequency !== 'NONE' && current.endKind === 'until' && (
              <label className={styles.field}>
                반복 종료일
                <input
                  type="date"
                  className={styles.input}
                  value={current.until}
                  min={current.date}
                  {...invalid('recurrence', 'until')}
                  onChange={(e) => update({ until: e.target.value })}
                />
              </label>
            )}
            {current.frequency !== 'NONE' && current.endKind === 'count' && (
              <label className={styles.field}>
                반복 횟수
                <input
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  className={styles.input}
                  value={current.count}
                  {...invalid('recurrence', 'count')}
                  onChange={(e) => update({ count: e.target.value })}
                />
              </label>
            )}
            {errors.recurrence && (
              <p id={`${id}-recurrence-error`} role="alert" className={styles.fieldError}>
                {errors.recurrence}
              </p>
            )}
          </fieldset>

          <TaskLinkField
            taskId={current.taskId}
            onChange={(taskId) => update({ taskId })}
            recurring={current.frequency !== 'NONE'}
          />

          <label className={styles.field}>
            메모
            <textarea
              className={styles.input}
              rows={3}
              maxLength={5000}
              value={current.memo}
              onChange={(e) => update({ memo: e.target.value })}
            />
          </label>

          <div className={styles.actions}>
            {latest && (
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  onClose()
                  onDelete(latest)
                }}
              >
                삭제
              </button>
            )}
            <span className={styles.grow} />
            <button type="button" className={styles.secondary} onClick={onClose}>
              취소
            </button>
            <button type="submit" className={styles.primary} disabled={saving}>
              저장
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

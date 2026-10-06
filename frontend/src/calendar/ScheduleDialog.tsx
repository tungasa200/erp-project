// 일정 상세·편집 (SCR-CAL-07). 새로 만들 때와 고칠 때 같은 모달을 쓴다. 저장 버튼이 있는 모달이다.
// 반복 일정은 저장·삭제할 때 범위를 묻는다(SCR-CAL-08). 종일 여부·반복 규칙을 바꾸면 "모든 일정"만 가능하다(계약 OccurrencePatch).
// ④ 연결 업무는 업무 API(P1-03), ⑥ 기록 상태는 P2라 아직 없다(연결된 taskId는 그대로 둔다).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { TASKS_QUERY_KEY } from '../tasks/api'
import { Modal } from './Modal'
import {
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
  endKind: EndKind
  until: string
  count: string
  memo: string
}

type Errors = Partial<Record<'title' | 'time' | 'recurrence', string>>

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
    endKind: 'never',
    until: '',
    count: '',
    memo: '',
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
    endKind: r?.until ? 'until' : r?.count ? 'count' : 'never',
    until: r?.until ?? '',
    count: r?.count ? String(r.count) : '',
    memo: o.memo ?? '',
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
  if (!f.title.trim()) errors.title = '일정 이름을 적어 주세요'
  if (!f.date) errors.time = '날짜를 골라 주세요'
  else if (f.allDay && f.endDate < f.date) errors.time = '끝나는 날을 시작일과 같거나 뒤로 골라 주세요'
  else if (!f.allDay && (!f.start || !f.end || toMinutes(f.end) <= toMinutes(f.start)))
    errors.time = '끝나는 시각을 시작보다 뒤로 골라 주세요'
  if (f.frequency === 'WEEKLY' && f.date && !f.weekdays.includes(WEEKDAYS[weekdayIndex(f.date)]))
    errors.recurrence = `시작일의 요일(${WEEKDAY_LABELS[weekdayIndex(f.date)]})을 포함해 주세요`
  if (f.endKind === 'until' && (!f.until || f.until < f.date))
    errors.recurrence = '반복 종료일을 시작일 뒤로 골라 주세요'
  if (f.endKind === 'count' && !(Number(f.count) >= 1 && Number(f.count) <= 999))
    errors.recurrence = '반복 횟수는 1~999 사이로 적어 주세요'
  return errors
}

/** 서버의 칸별 오류(errors[])를 화면 칸으로 옮긴다(2.5) */
function serverErrors(error: ApiError): Errors | null {
  const list = error.problem?.errors
  if (!list?.length) return null
  const result: Errors = {}
  for (const e of list) {
    if (e.field === 'title') result.title = '일정 이름을 확인해 주세요'
    else if (e.field.startsWith('recurrence')) result.recurrence = '반복 설정을 확인해 주세요'
    else result.time = '시간을 확인해 주세요'
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

  // 고칠 때는 원본(반복 규칙)을 받은 뒤 채운다
  const current = form ?? (occurrence && schedule.data ? formFromOccurrence(occurrence, schedule.data, timeZone) : null)
  const update = (patch: Partial<Form>) => {
    setForm({ ...current!, ...patch })
    setErrors({})
  }

  const failed = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return setConflict(true)
    const fields = error instanceof ApiError ? serverErrors(error) : null
    if (fields) return setErrors(fields)
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const reload = async () => {
    setConflict(false)
    setForm(null)
    setErrors({})
    await schedule.refetch()
    void invalidate()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || saving) return
    const found = validate(current)
    if (Object.keys(found).length) return setErrors(found)
    setSaving(true)
    try {
      if (!occurrence) await create(current)
      else if (!(await save(occurrence, schedule.data!, current))) return
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
      taskId: draft?.taskId ?? null,
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
    if (!timeChanged && !kindChanged && !recurrenceChanged && Object.keys(textPatch).length === 0) return true

    if (o.recurring) {
      const scope = await askScope(o, kindChanged || recurrenceChanged ? 'editSeries' : 'edit')
      if (!scope) return false
      if (scope === 'this') {
        await scheduleApi.updateOccurrence(o.scheduleId, o.occurrenceStart, {
          version: o.version,
          ...textPatch,
          ...(timeChanged && timeOf(f, timeZone)),
        })
        showToast('이 일정만 바꿨어요')
        return true
      }
    }
    const patch: SchedulePatch = { version: s.version, ...textPatch }
    if (kindChanged) Object.assign(patch, { allDay: f.allDay, ...timeOf(f, timeZone) })
    else if (timeChanged)
      Object.assign(patch, o.recurring ? shiftSchedule(s, o, timeOf(f, timeZone)) : timeOf(f, timeZone))
    if (recurrenceChanged) patch.recurrence = recurrenceOf(f)
    await scheduleApi.update(o.scheduleId, patch)
    showToast(o.recurring ? '모든 일정을 바꿨어요' : '일정을 저장했어요')
    return true
  }

  const title = occurrence ? '일정 편집' : '새 일정'

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
        <form className={styles.fieldset} onSubmit={(e) => void submit(e)} noValidate>
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
            <p id={`${id}-title-error`} className={styles.fieldError}>
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
                onChange={(e) => {
                  const date = e.target.value
                  if (!date) return update({ date })
                  // 종일 일정은 기간을 유지하고, 매주 반복은 새 시작 요일을 넣는다
                  const weekday = WEEKDAYS[weekdayIndex(date)]
                  update({
                    date,
                    endDate: current.allDay
                      ? addDays(date, Math.max(0, diffDays(current.date, current.endDate)))
                      : date,
                    weekdays: current.weekdays.includes(weekday) ? current.weekdays : [...current.weekdays, weekday],
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
                    onChange={(e) => update({ end: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          {errors.time && <p className={styles.fieldError}>{errors.time}</p>}
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
            <div className={styles.segment} role="group" aria-label="반복 주기">
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
              <div className={styles.segment} role="group" aria-label="반복 요일">
                {[1, 2, 3, 4, 5, 6, 0].map((i) => {
                  const w = WEEKDAYS[i]
                  const on = current.weekdays.includes(w)
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        update({ weekdays: on ? current.weekdays.filter((x) => x !== w) : [...current.weekdays, w] })
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
                  onChange={(e) => update({ count: e.target.value })}
                />
              </label>
            )}
            {errors.recurrence && <p className={styles.fieldError}>{errors.recurrence}</p>}
          </fieldset>

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
            {occurrence && (
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  onClose()
                  onDelete(occurrence)
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

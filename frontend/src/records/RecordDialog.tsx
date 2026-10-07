// SCR-REC-01 기록 추가·수정 (REC-01, TIME-04·06, P2-01 계약 D-98). 업무 기록 한 건을 직접 만들거나 고친다.
// ① 한 일 ② 연결 업무 ③ 결과 한 줄 + 칩 ④ 날짜 ⑤ (시간 기록 옵션) 시작~종료 또는 소요시간 ⑥ 출처 ⑦ 삭제·저장.
// 확인 대기 기록을 고치면(SCR-HOME-02 "수정") 고친 칸과 status=CONFIRMED를 한 요청으로 보낸다(계약 PATCH 설명).
// 시간 칸은 옵션이 켜졌을 때만 보이고, 꺼져 있으면 저장된 시간을 건드리지 않는다(옵션은 화면 표시만 바꾼다, TIME-09).
// 시작을 적으면 종료도 받는다(D-101 초안: startAt이면 endAt 필수, 진행 중 기록은 타이머만 만든다).
// 확인 대기 기록은 시간이 비어 있어(D-100) planned로 받은 계획 시각을 시작·종료 칸에 채워 둔다(WY-pm 결정 2026-10-07).
// 채운 값은 기록과 다르므로 저장하면 고친 칸처럼 startAt·endAt을 함께 보낸다.
// 24시간에서 잘린 타이머 기록(capped)은 종료가 다음 날 같은 시각이라 하루 안 칸으로 옮길 수 없다: 종료를 비우고 안내하며 연다(WY-pm 결정).
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { Modal } from '../calendar/Modal'
import { TaskLinkField } from '../calendar/TaskLinkField'
import { MINUTES_PER_DAY, formatMinutes, fromZoned, toZoned } from '../calendar/time'
import calendar from '../calendar/calendar.module.css'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { shortDate } from '../quickInput/dates'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { RECORDS_QUERY_KEY, recordApi, type WorkRecord, type WorkRecordCreate, type WorkRecordOutcome } from './api'
import { OutcomeChips } from './OutcomeChips'
import { recordEditApi, useDayRecords, useRecord, type WorkRecordPatch } from './recordEdit'
import styles from './RecordDialog.module.css'

interface Form {
  content: string
  taskId: string | null
  result: string
  outcome: WorkRecordOutcome | null
  progress: number
  workDate: string
  /** HH:MM, 비었으면 '' */
  start: string
  end: string
  /** 분, 시작~종료가 없을 때만 */
  duration: string
}

type Field = 'content' | 'task' | 'workDate' | 'time'
type TimeField = 'start' | 'end' | 'duration'
type Errors = Partial<Record<Field, string>> & { timeAt?: TimeField }

interface Props {
  /** 고칠 기록. 없으면 새 기록 */
  recordId?: string
  /** 새 기록의 처음 값 */
  defaults?: { workDate: string; taskId?: string | null; content?: string }
  /** 고칠 기록에 시작이 없을 때(확인 대기) 시작·종료 칸에 채울 계획 시각. 종일 계획이면 넘기지 않는다 */
  planned?: { startAt: string; endAt: string }
  /** 24시간에서 잘린 타이머 기록: 종료 칸을 비우고 끝난 시각을 넣어 달라고 안내한다 */
  capped?: boolean
  /** changed: 저장하거나 삭제했으면 true */
  onClose: (changed: boolean) => void
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formFromRecord(r: WorkRecord, timeZone: string): Form {
  const s = r.startAt ? toZoned(r.startAt, timeZone) : null
  const e = r.endAt ? toZoned(r.endAt, timeZone) : null
  return {
    content: r.content,
    taskId: r.taskId ?? null,
    result: r.result ?? '',
    outcome: r.outcome ?? null,
    progress: r.progress ?? 0,
    workDate: s?.date ?? r.workDate,
    start: s ? formatMinutes(s.minutes) : '',
    end: e ? formatMinutes(e.minutes) : '',
    duration: !s && r.durationMin ? String(r.durationMin) : '',
  }
}

/** 시작이 빈 기록이면 계획 시각으로 시작·종료를 채운 폼. 날짜는 기록의 날짜를 둔다(시작·종료가 그 날로 간다) */
function formWithPlan(r: WorkRecord, timeZone: string, planned: Props['planned']): Form {
  const form = formFromRecord(r, timeZone)
  if (r.startAt || !planned) return form
  const s = toZoned(planned.startAt, timeZone)
  const e = toZoned(planned.endAt, timeZone)
  // 다음 날 0시에 끝나면 그날 23:59로, 그보다 늦게 끝나면 종료는 비워 둔다(기록은 하루 안)
  const end = e.date === s.date ? formatMinutes(e.minutes) : e.minutes === 0 ? formatMinutes(MINUTES_PER_DAY - 1) : ''
  return { ...form, start: formatMinutes(s.minutes), end, duration: '' }
}

/** 시작~종료(분). 둘 다 있고 순서가 맞을 때만 */
function span(f: Form): [number, number] | null {
  if (!f.start || !f.end) return null
  const a = toMinutes(f.start)
  const b = toMinutes(f.end)
  return b > a ? [a, b] : null
}

function validate(f: Form, timed: boolean, running: boolean): Errors {
  const errors: Errors = {}
  const time = (message: string, at: TimeField) => Object.assign(errors, { time: message, timeAt: at })
  if (!f.content.trim()) errors.content = '한 일을 적어 주세요'
  if (!f.workDate) errors.workDate = '날짜를 골라 주세요'
  if (!timed) return errors
  // 실행 중인 타이머는 시작을 비울 수 없다(계약 PATCH: 시작·내용·업무만 고친다)
  if (running && !f.start) time('타이머의 시작 시각을 골라 주세요', 'start')
  else if (!f.start && f.end) time('시작 시각도 골라 주세요', 'start')
  // 실행 중인 타이머는 종료 없이 둘 수 있다(종료를 넣으면 정지와 같다)
  else if (f.start && !f.end && !running) time('종료 시각도 골라 주세요', 'end')
  else if (f.start && f.end && !span(f)) time('종료를 시작보다 뒤로 골라 주세요', 'end')
  else if (!f.start && f.duration && !(Number(f.duration) >= 1 && Number(f.duration) <= 1440))
    time('소요시간은 1~1440분으로 적어 주세요', 'duration')
  return errors
}

/** 화면 값 → 계약의 시간 칸. 옵션이 꺼져 있으면 보내지 않는다 */
function timeOf(f: Form, timeZone: string) {
  if (f.start) {
    return {
      startAt: fromZoned(f.workDate, toMinutes(f.start), timeZone),
      // 종료가 비는 것은 실행 중인 타이머뿐이다(validate)
      endAt: f.end ? fromZoned(f.workDate, toMinutes(f.end), timeZone) : null,
      durationMin: null,
    }
  }
  return { startAt: null, endAt: null, durationMin: f.duration ? Number(f.duration) : null }
}

/** 서버의 칸별 오류(errors[])를 화면 칸으로 옮긴다(2.5) */
function serverErrors(error: ApiError): Errors | null {
  const list = error.problem?.errors
  if (!list?.length) return null
  const result: Errors = {}
  const timeFields: Record<string, TimeField> = { startAt: 'start', endAt: 'end', durationMin: 'duration' }
  for (const e of list) {
    if (e.field === 'content') result.content = '한 일을 확인해 주세요'
    else if (e.field === 'workDate') result.workDate = '날짜를 확인해 주세요'
    else if (e.field in timeFields) {
      result.time ??= e.code === 'INVALID_ORDER' ? '종료를 시작보다 뒤로 골라 주세요' : '시간을 확인해 주세요'
      result.timeAt ??= timeFields[e.field]
    }
  }
  return Object.keys(result).length ? result : null
}

/** 두 구간 [시작, 종료)가 겹치는지. 서버 시각은 오프셋 표기가 달라도 같은 순간이라 숫자로 비교한다 */
/** 경고 문구 안의 다른 기록 이름은 한 줄로 줄인다(내용은 500자까지) */
const clip = (text: string) => (text.length > 30 ? `${text.slice(0, 30)}…` : text)

const overlaps = (a: [number, number], b: [string, string]) => {
  const [c, d] = b.map(Date.parse)
  return a[0] < d && c < a[1]
}

export function RecordDialog({ recordId, defaults, planned, capped, onClose }: Props) {
  const id = useId()
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const timed = useTimeTracking()
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const online = useOnline()
  const record = useRecord(recordId)
  const original = record.data
  const [form, setForm] = useState<Form | null>(
    recordId
      ? null
      : {
          content: defaults?.content ?? '',
          taskId: defaults?.taskId ?? null,
          result: '',
          outcome: null,
          progress: 0,
          workDate: defaults?.workDate ?? '',
          start: '',
          end: '',
          duration: '',
        },
  )
  const [errors, setErrors] = useState<Errors>({})
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const current =
    form ??
    (original ? { ...formWithPlan(original, timeZone, planned), ...(capped && timed ? { end: '' } : {}) } : null)
  const running = !!original?.startAt && !original.endAt
  const archived = !!original?.deletedAt
  const editable = online && !archived

  // 칸이 나타나면 한 일로 포커스(고칠 때는 기록을 받은 뒤). 잘린 기록은 채워야 할 종료로
  const ready = !!current
  const cappedOpen = !!capped && timed
  useEffect(() => {
    if (ready) (cappedOpen ? endRef : contentRef).current?.focus()
  }, [ready, cappedOpen])
  // 오프라인이면 열어 보기만 한다(SCR-SYS-02 ③). 칸이 꺼지며 포커스를 잃으면 닫기 버튼으로 옮겨 Esc가 계속 듣게 한다
  useEffect(() => {
    const active = document.activeElement
    if (!online && (active === document.body || (active instanceof HTMLElement && active.matches(':disabled'))))
      closeRef.current?.focus()
  }, [online])
  // 저장이 칸 오류로 막히면 첫 오류 칸으로 포커스(2.5)
  const [errorFocus, setErrorFocus] = useState(0)
  useEffect(() => {
    if (errorFocus) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errorFocus])
  const showErrors = (found: Errors) => {
    setErrors(found)
    setErrorFocus((n) => n + 1)
  }

  const update = (patch: Partial<Form>) => {
    setForm({ ...current!, ...patch })
    setErrors({})
  }

  // 같은 날 다른 기록과 시간이 겹치면 경고한다(저장은 된다, TIME-06)
  const mine = current && timed ? span(current) : null
  const day = useDayRecords(current?.workDate ?? '', !!mine)
  const clash =
    mine && current
      ? day.data?.find(
          (r) =>
            r.id !== recordId &&
            !r.deletedAt &&
            r.startAt &&
            r.endAt &&
            overlaps(
              [
                Date.parse(fromZoned(current.workDate, mine[0], timeZone)),
                Date.parse(fromZoned(current.workDate, mine[1], timeZone)),
              ],
              [r.startAt, r.endAt],
            ),
        )
      : undefined

  const refresh = () => void queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY })

  /** taskChanged: 이번 요청이 업무를 새로 연결했는지(그때의 404는 업무가 없다는 뜻) */
  const failed = (error: unknown, taskChanged = false) => {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return setConflict(true)
    // 다른 곳에서 지웠으면 다시 받아 "삭제한 기록이에요"를 보인다
    if (error instanceof ApiError && (error.code === 'RECORD_DELETED' || (error.status === 404 && !taskChanged)))
      return void reload()
    if (error instanceof ApiError && error.status === 404)
      return showErrors({ task: '연결한 업무를 찾지 못했어요. 보관됐을 수 있어요' })
    const fields = error instanceof ApiError ? serverErrors(error) : null
    if (fields) return showErrors(fields)
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const reload = async () => {
    setConflict(false)
    setForm(null)
    setErrors({})
    await record.refetch()
  }

  const create = async (f: Form) => {
    const body: WorkRecordCreate = {
      content: f.content.trim(),
      taskId: f.taskId,
      workDate: f.workDate,
      result: f.result.trim() || null,
      outcome: f.outcome,
      progress: f.outcome === 'IN_PROGRESS' ? f.progress : null,
      ...(timed && timeOf(f, timeZone)),
    }
    await recordApi.create(body)
    showToast('기록을 남겼어요')
  }

  /** 바꾼 칸만 보낸다. 확인 대기 기록은 저장하면 확정한다 */
  const save = async (r: WorkRecord, f: Form) => {
    const before = formFromRecord(r, timeZone)
    const patch: WorkRecordPatch = { version: r.version }
    if (f.content.trim() !== r.content) patch.content = f.content.trim()
    if (f.taskId !== before.taskId) patch.taskId = f.taskId
    if ((f.result.trim() || null) !== (r.result ?? null)) patch.result = f.result.trim() || null
    const progress = f.outcome === 'IN_PROGRESS' ? f.progress : null
    if (f.outcome !== before.outcome || progress !== (r.progress ?? null)) {
      patch.outcome = f.outcome
      patch.progress = progress
    }
    if (f.workDate !== before.workDate) patch.workDate = f.workDate
    if (timed && (f.start !== before.start || f.end !== before.end || f.duration !== before.duration))
      Object.assign(patch, timeOf(f, timeZone))
    // 날짜만 바꿨고 시작이 있으면 시작·종료를 그 날로 옮긴다(workDate는 startAt으로 계산되므로)
    else if (patch.workDate && r.startAt && timed) Object.assign(patch, timeOf(f, timeZone))
    if (r.status === 'PENDING') patch.status = 'CONFIRMED'
    if (Object.keys(patch).length === 1) return false
    await recordEditApi.update(r.id, patch)
    showToast(r.status === 'PENDING' ? '고쳐서 했어요로 기록했어요' : '기록을 저장했어요')
    return true
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || saving || !editable) return
    const found = validate(current, timed, running)
    if (Object.keys(found).length) return showErrors(found)
    setSaving(true)
    try {
      const changed = original ? await save(original, current) : (await create(current), true)
      if (changed) refresh()
      onClose(changed)
    } catch (error) {
      const before = original && formFromRecord(original, timeZone)
      failed(error, !!current.taskId && current.taskId !== before?.taskId)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!original || saving) return
    setSaving(true)
    try {
      await recordApi.remove(original.id)
      refresh()
      onClose(true)
      showUndo({
        group: 'record-delete',
        message: (n) => (n > 1 ? `기록 ${n}건을 삭제했어요` : '기록을 삭제했어요'),
        undo: async () => {
          try {
            await recordEditApi.restore(original.id)
          } catch (error) {
            const { message, traceId } = toastForError(error)
            showToast(message, { traceId })
          }
          refresh()
        },
      })
    } catch (error) {
      setSaving(false)
      failed(error)
    }
  }

  const invalid = (field: Field, at?: TimeField) =>
    (at ? errors.timeAt === at : errors[field])
      ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-${field}-error` }
      : {}
  const fieldError = (field: Field) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} role="alert" className={calendar.fieldError}>
        {errors[field]}
      </p>
    )

  const title = recordId ? (original?.status === 'PENDING' ? '확인 대기 수정' : '기록 수정') : '기록 추가'
  const source = original?.occurrenceStart ? toZoned(original.occurrenceStart, timeZone) : null
  const computed = current && span(current)

  return (
    <Modal labelledBy={`${id}-title`} onClose={() => onClose(false)}>
      <div className={calendar.dialogHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          ref={closeRef}
          className={calendar.close}
          aria-label="닫기"
          onClick={() => onClose(false)}
        >
          ×
        </button>
      </div>
      {conflict && (
        <div className={calendar.conflict} role="alert">
          <span style={{ flex: 1 }}>다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요</span>
          <button type="button" className={calendar.secondary} onClick={() => void reload()}>
            새로 불러오기
          </button>
        </div>
      )}
      {!current ? (
        record.isError ? (
          <p className={calendar.muted}>기록을 불러오지 못했어요. 이미 삭제됐을 수 있어요</p>
        ) : record.fetchStatus === 'paused' ? (
          <p className={calendar.muted} role="status">
            연결되면 기록을 불러올게요
          </p>
        ) : (
          <Skeleton shape="lines" count={4} />
        )
      ) : (
        <form ref={formRef} className={calendar.fieldset} onSubmit={(e) => void submit(e)} noValidate>
          {!online && (
            <p className={calendar.muted} role="status">
              연결이 끊겼어요. 다시 연결되면 고칠 수 있어요
            </p>
          )}
          {archived && (
            <p className={calendar.muted} role="status">
              삭제한 기록이에요. 고치려면 먼저 되돌려 주세요
            </p>
          )}
          {source && (
            <p className={styles.source}>
              계획에서 온 기록 · {shortDate(source.date)} {formatMinutes(source.minutes)} 회차
              {original?.status === 'PENDING' && ' — 저장하면 했어요로 기록돼요'}
            </p>
          )}
          <fieldset className={calendar.fieldset} disabled={!editable}>
            <label className={calendar.field}>
              한 일
              <textarea
                ref={contentRef}
                className={calendar.input}
                rows={2}
                maxLength={500}
                value={current.content}
                onChange={(e) => update({ content: e.target.value })}
                {...invalid('content')}
              />
            </label>
            {fieldError('content')}

            <TaskLinkField taskId={current.taskId} onChange={(taskId) => update({ taskId })} recurring={false} />
            {fieldError('task')}

            <div className={calendar.field}>
              <label htmlFor={`${id}-result`}>결과 한 줄</label>
              <input
                id={`${id}-result`}
                className={calendar.input}
                maxLength={200}
                autoComplete="off"
                placeholder="예: 초안 공유, 금요일에 확정"
                value={current.result}
                onChange={(e) => update({ result: e.target.value })}
              />
              <OutcomeChips
                allowNone
                outcome={current.outcome}
                progress={current.progress}
                onChange={(outcome, progress) => update({ outcome, progress })}
              />
            </div>

            <label className={calendar.field}>
              날짜
              <input
                type="date"
                className={calendar.input}
                value={current.workDate}
                onChange={(e) => update({ workDate: e.target.value })}
                {...invalid('workDate')}
              />
            </label>
            {fieldError('workDate')}

            {timed && (
              <fieldset className={calendar.fieldset}>
                <legend>시간</legend>
                <div className={calendar.row}>
                  <label className={calendar.field}>
                    시작
                    <input
                      type="time"
                      step={300}
                      className={calendar.input}
                      value={current.start}
                      onChange={(e) => update({ start: e.target.value })}
                      {...invalid('time', 'start')}
                    />
                  </label>
                  <label className={calendar.field}>
                    종료
                    <input
                      ref={endRef}
                      type="time"
                      step={300}
                      className={calendar.input}
                      value={current.end}
                      placeholder={running ? '진행 중' : undefined}
                      onChange={(e) => update({ end: e.target.value })}
                      {...(cappedOpen ? { 'aria-describedby': `${id}-capped` } : {})}
                      {...invalid('time', 'end')}
                    />
                  </label>
                  <label className={calendar.field}>
                    또는 소요시간(분)
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      inputMode="numeric"
                      className={calendar.input}
                      disabled={!!(current.start || current.end)}
                      value={computed ? String(computed[1] - computed[0]) : current.duration}
                      onChange={(e) => update({ duration: e.target.value })}
                      {...invalid('time', 'duration')}
                    />
                  </label>
                </div>
                {cappedOpen && (
                  <p id={`${id}-capped`} className={calendar.muted}>
                    24시간을 넘겨 잘렸어요. 끝난 시각을 넣어 주세요
                  </p>
                )}
                {running && !current.end && (
                  <p className={calendar.muted}>타이머가 돌고 있어요. 종료를 넣으면 멈춰요</p>
                )}
                {fieldError('time')}
                {clash && !errors.time && (
                  <p className={styles.warning} role="status">
                    다른 기록과 시간이 겹쳐요: {clip(clash.content)} (
                    {formatMinutes(toZoned(clash.startAt!, timeZone).minutes)}~
                    {formatMinutes(toZoned(clash.endAt!, timeZone).minutes)}). 그래도 저장할 수 있어요
                  </p>
                )}
              </fieldset>
            )}
          </fieldset>
          <div className={calendar.actions}>
            {original && !archived && (
              <button
                type="button"
                className={calendar.danger}
                disabled={!online || saving}
                onClick={() => void remove()}
              >
                삭제
              </button>
            )}
            <span className={calendar.grow} />
            <button type="button" className={calendar.secondary} onClick={() => onClose(false)}>
              취소
            </button>
            <button type="submit" className={calendar.primary} disabled={saving || !editable}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

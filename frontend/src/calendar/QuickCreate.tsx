// 일정 빠른 생성 (SCR-CAL-06). 선택한 시간이 기본이고, 입력에 시간·날짜가 있으면 그 값으로 덮어쓴다.
// 한 줄 해석은 빠른 입력(P1-09)의 parseQuickInput을 쓴다. ③ 해석 칩은 업무에 들어갈 @프로젝트·#태그·!우선순위·~마감을 보여 주고,
// ④ "업무로도 만들기"(기본 켜짐)면 그 값으로 업무를 만들어 일정에 연결한다. 끄면 그 토큰은 제목에 남긴다(scheduleParse, P1-09-09).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { toastForError } from '../api/errorToast'
import { PROJECTS_QUERY_KEY, projectApi, TAGS_QUERY_KEY, tagApi, type Project } from '../projects/api'
import { nextColor, projectColor } from '../projects/palette'
import { shortDate, weekStartNumber } from '../quickInput/dates'
import { parseQuickInput } from '../quickInput/parse'
import { refreshTasks, taskApi } from '../tasks/api'
import { NeedsProjectError, saveQuickDraft } from '../tasks/quickSave'
import { useCreateSchedule, type ScheduleCreate } from './api'
import { parseForSchedule } from './scheduleParse'
import { markFocus, restoreFocus } from './focus'
import { MINUTES_PER_DAY, WEEKDAY_LABELS, formatMinutes, fromZoned, todayIn, weekdayIndex } from './time'
import styles from './calendar.module.css'

/** 빠른 생성의 대상. allDay면 start·end는 쓰지 않는다 */
export interface CreateTarget {
  date: string
  start: number
  end: number
  allDay: boolean
}

export interface ScheduleDraft extends CreateTarget {
  title: string
  /** 업무 패널의 "일정 잡기"로 열면 그 업무에 연결한다(P1-08) */
  taskId?: string
}

interface Props {
  target: CreateTarget
  timeZone: string
  /** 팝오버를 띄울 화면 좌표 */
  anchor: { x: number; y: number }
  onClose: () => void
  onDetails: (draft: ScheduleDraft) => void
}

const PRIORITY_LABEL = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' } as const
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.min(MINUTES_PER_DAY, h * 60 + m)
}

function targetLabel(t: CreateTarget) {
  const [, m, d] = t.date.split('-').map(Number)
  const day = `${m}월 ${d}일 (${WEEKDAY_LABELS[weekdayIndex(t.date)]})`
  return t.allDay ? `${day} 종일` : `${day} ${formatMinutes(t.start)}–${formatMinutes(t.end)}`
}

export function QuickCreate({ target, timeZone, anchor, onClose, onDetails }: Props) {
  const id = useId()
  const { user } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const create = useCreateSchedule()
  const [text, setText] = useState('')
  const [asTask, setAsTask] = useState(true)
  const [saving, setSaving] = useState(false)
  // 연 뒤에 연결이 끊기면 저장만 막는다. 입력은 두어 포커스·Esc가 그대로 동작한다
  const online = useOnline()
  const [error, setError] = useState<string | null>(null)

  // 닫으면 연 자리로 포커스를 돌린다(빈 칸을 눌러 열었으면 캘린더 제목)
  useEffect(() => {
    const previous = markFocus()
    return () => restoreFocus(previous)
  }, [])

  const today = todayIn(timeZone)
  const weekStart = weekStartNumber(user?.weekStart)
  // full: 업무 칸까지 해석(업무로도 만들 때). kept: 업무 토큰을 제목에 남긴 해석(업무를 안 만들 때·자세히)
  const full = useMemo(() => parseQuickInput(text, { today, weekStart }), [text, today, weekStart])
  const kept = useMemo(() => parseForSchedule(text, { today, weekStart }), [text, today, weekStart])
  const parsed = asTask ? full : kept
  // 입력에 시간이 있으면 시간 일정, 날짜가 있으면 그 날짜로 바꾼다
  const draft: ScheduleDraft = {
    title: parsed.title,
    date: parsed.date ?? target.date,
    allDay: parsed.time ? false : target.allDay,
    start: parsed.time ? toMinutes(parsed.time.start) : target.start,
    end: parsed.time ? toMinutes(parsed.time.end) : target.end,
  }
  const overridden = draft.date !== target.date || draft.start !== target.start || draft.allDay !== target.allDay

  // @·#을 쓸 때만 목록을 받는다(빠른 입력과 같은 캐시)
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: async () => (await projectApi.list()).items,
    enabled: asTask && Boolean(full.project),
    staleTime: 30_000,
  })
  const tags = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: async () => (await tagApi.list()).items,
    enabled: asTask && Boolean(full.tags?.length),
    staleTime: 30_000,
  })
  const project = full.project ? projects.data?.find((p) => sameName(p.name, full.project!)) : undefined
  // 목록을 아직 못 받았으면 새 프로젝트로 단정하지 않는다
  const missingProject = full.project && projects.data && !project ? full.project : null
  const day = (date: string) => (date === today ? '오늘' : shortDate(date))
  const showChips = asTask && Boolean(full.project || full.tags?.length || full.priority || full.due)

  const inputRef = useRef<HTMLInputElement>(null)
  // 저장·프로젝트 만들기 버튼이 꺼지며 포커스를 잃으면 입력칸으로 옮겨 Esc가 계속 듣게 한다
  useEffect(() => {
    const active = document.activeElement
    if (!online && (active === document.body || (active instanceof HTMLElement && active.matches(':disabled'))))
      inputRef.current?.focus()
  }, [online])
  // 오류는 입력 칸에 연결하고 포커스를 그 칸으로(2.5). 저장 버튼을 눌러도 칸으로 돌아온다
  const showError = (message: string) => {
    setError(message)
    inputRef.current?.focus()
  }

  const createProject = async (name: string) => {
    // 만들면 이 칩이 프로젝트 칩으로 바뀌어 사라지므로 입력칸으로 포커스를 돌린다
    inputRef.current?.focus()
    try {
      const created = await projectApi.create({ name, color: nextColor(projects.data ?? []) })
      queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => [...(list ?? []), created])
      setError(null)
    } catch (err) {
      // 다른 곳에서 먼저 만들었으면 목록을 다시 받아 그 프로젝트로 보여 준다
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') void projects.refetch()
      else {
        const { message, traceId } = toastForError(err)
        showToast(message, { traceId })
      }
    }
  }

  const scheduleBody = (taskId?: string): ScheduleCreate =>
    draft.allDay
      ? { title: draft.title, allDay: true, startDate: draft.date, endDate: draft.date, taskId }
      : {
          title: draft.title,
          allDay: false,
          startAt: fromZoned(draft.date, draft.start, timeZone),
          endAt: fromZoned(draft.date, draft.end, timeZone),
          taskId,
        }

  /** 업무를 먼저 만들고 그 업무에 연결한 일정을 만든다. 일정을 못 만들면 업무만 남지 않게 지운다 */
  const saveWithTask = async () => {
    const projectList = full.project
      ? await queryClient.fetchQuery({
          queryKey: PROJECTS_QUERY_KEY,
          queryFn: async () => (await projectApi.list()).items,
          staleTime: 30_000,
        })
      : []
    const { title, project: projectName, tags: tagNames, priority, due } = full
    const { task } = await saveQuickDraft(
      { title, project: projectName, tags: tagNames, priority, due },
      { projects: projectList, timeZone },
    )
    try {
      await create.mutateAsync(scheduleBody(task.id))
    } catch (err) {
      await taskApi.remove(task.id).catch(() => {})
      throw err
    } finally {
      refreshTasks(queryClient)
      if (tagNames?.length) void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
    }
  }

  const save = async () => {
    if (saving || !online) return
    if (!draft.title) return showError('일정 이름을 적어 주세요')
    setSaving(true)
    try {
      if (asTask) await saveWithTask()
      else await create.mutateAsync(scheduleBody())
      showToast(asTask ? '일정과 업무를 만들었어요' : '일정을 만들었어요')
      onClose()
    } catch (err) {
      setSaving(false)
      if (err instanceof NeedsProjectError)
        return showError(`"${err.projectName}" 프로젝트가 없어요. 위 칩을 눌러 먼저 만들어 주세요`)
      const fieldError = err instanceof ApiError ? err.problem?.errors?.[0] : undefined
      if (fieldError?.field === 'title') showError('일정 이름을 확인해 주세요')
      else if (fieldError) showError('입력한 값을 확인해 주세요')
      else {
        const { message, traceId } = toastForError(err)
        showToast(message, { traceId })
      }
    }
  }

  // 자세히로 넘길 때는 업무 토큰을 제목에 남겨 입력이 사라지지 않게 한다
  const toDetails = () => onDetails({ ...draft, title: kept.title })

  return (
    <div className={styles.popoverLayer} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={styles.popover}
        style={{
          left: Math.max(16, Math.min(anchor.x, window.innerWidth - 396)),
          top: Math.max(16, Math.min(anchor.y, window.innerHeight - 420)),
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 id={`${id}-title`} className={styles.cardTitle} style={{ padding: 0, fontSize: 15 }}>
          새 일정
        </h2>
        <button
          type="button"
          className={styles.timeChip}
          onClick={toDetails}
          aria-label={`${targetLabel(draft)}, 시간 바꾸기`}
        >
          {targetLabel(draft)} ▾
        </button>
        <label className={styles.field}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            한 줄 입력
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            autoFocus
            autoComplete="off"
            placeholder="예: 견적 회의 14-15 @영업 #견적"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            // 한글 조합 중 Enter는 조합 확정이라 저장하지 않는다
            onKeyDown={(e) => e.key === 'Enter' && e.nativeEvent.isComposing && e.preventDefault()}
            aria-invalid={!!error}
            aria-describedby={
              [error && `${id}-error`, showChips && `${id}-chips`].filter(Boolean).join(' ') || undefined
            }
          />
        </label>
        {showChips && (
          <ul id={`${id}-chips`} className={styles.parseChips} aria-label="업무에 넣을 값">
            {full.project &&
              (missingProject ? (
                <li>
                  <button
                    type="button"
                    className={`${styles.parseChip} ${styles.parseChipNew}`}
                    onClick={() => void createProject(missingProject)}
                    disabled={!online}
                  >
                    + 새 프로젝트 "{missingProject}" 만들기
                  </button>
                </li>
              ) : (
                <li
                  className={styles.parseChip}
                  style={
                    project && { background: projectColor(project.color).tint, color: projectColor(project.color).ink }
                  }
                >
                  @{project?.name ?? full.project}
                </li>
              ))}
            {full.tags?.map((name) => {
              const isNew = tags.data !== undefined && !tags.data.some((t) => sameName(t.name, name))
              return (
                <li
                  key={name}
                  className={`${styles.parseChip} ${styles.parseChipTag}`}
                  data-new={isNew || undefined}
                  aria-label={isNew ? `새 태그 ${name}` : undefined}
                >
                  #{name}
                  {isNew && (
                    <span className={styles.parseChipBadge} aria-hidden="true">
                      새
                    </span>
                  )}
                </li>
              )
            })}
            {full.priority && (
              <li className={styles.parseChip} data-strong={full.priority === 'HIGH' || undefined}>
                우선순위 {PRIORITY_LABEL[full.priority]}
              </li>
            )}
            {full.due && <li className={styles.parseChip}>마감 {day(full.due)}</li>}
          </ul>
        )}
        {overridden && <p className={styles.muted}>입력한 시간으로 만들어요</p>}
        {!online && (
          <p className={styles.muted} role="status">
            연결이 끊겼어요. 다시 연결되면 만들 수 있어요
          </p>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className={styles.fieldError}>
            {error}
          </p>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            role="switch"
            checked={asTask}
            onChange={(e) => {
              setAsTask(e.target.checked)
              setError(null)
            }}
          />
          업무로도 만들기
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.link} onClick={toDetails}>
            자세히
          </button>
          <button type="submit" className={styles.primary} disabled={saving || !online}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}

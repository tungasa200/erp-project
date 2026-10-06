// SCR-TASK-02 업무 상세 (오른쪽 패널, 모바일은 전체 화면). 모든 변경은 항목별 자동 저장이고(저장 버튼 없음),
// 저장은 한 줄로 세워 앞 응답의 version으로 다음 저장을 보낸다. 409는 충돌 띠(2.5), 보관한 업무는 읽기 전용 + 복원.
// 기록 이력(⑥)은 P2, 이월 이력(⑦)은 P3에서 채운다. 연결 일정 목록(⑤)은 업무별 일정 조회 API가 없어 배치 여부와 캘린더 링크만 둔다.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { isValidDate } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { TAGS_QUERY_KEY, tagApi, useProjects, useTags } from '../projects/api'
import { projectColor } from '../projects/palette'
import { refreshTasks, taskApi, taskKey, useTask, type Task, type TaskPatch } from './api'
import type { TaskListOutletContext } from './TaskListPage'
import styles from './tasks.module.css'
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES } from './view'

type Patch = Omit<TaskPatch, 'version'>
type SaveResult = { ok: true } | { ok: false; message: string | null }

function useTaskSaver(id: string) {
  const queryClient = useQueryClient()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [conflict, setConflict] = useState(false)

  const save = useCallback(
    (patch: Patch): Promise<SaveResult> => {
      const run = async (): Promise<SaveResult> => {
        const current = queryClient.getQueryData<Task>(taskKey(id))
        if (!current) return { ok: false, message: '저장하지 못했어요' }
        try {
          const task = await taskApi.update(id, { ...patch, version: current.version })
          queryClient.setQueryData(taskKey(id), task)
          refreshTasks(queryClient, ['tasks', 'list'])
          return { ok: true }
        } catch (error) {
          if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
            setConflict(true)
            return { ok: false, message: null }
          }
          if (error instanceof ApiError && error.code === 'TASK_DELETED') {
            void queryClient.refetchQueries({ queryKey: taskKey(id) })
            return { ok: false, message: '보관한 업무라 바꿀 수 없어요' }
          }
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            return { ok: false, message: '입력한 값을 확인해 주세요' }
          }
          return { ok: false, message: toastForError(error).message }
        }
      }
      const result = queue.current.then(run)
      queue.current = result
      return result
    },
    [id, queryClient],
  )

  // 새로 받은 값을 돌려준다(캐시 구독자는 다음 틱에 갱신되므로 화면은 이 값으로 다시 채운다)
  const reload = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: taskKey(id) })
    setConflict(false)
    return queryClient.getQueryData<Task>(taskKey(id)) ?? null
  }, [id, queryClient])

  return { save, conflict, reload }
}

export function TaskDetailPanel() {
  const { taskId = '' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const task = useTask(taskId)
  const { save, conflict, reload } = useTaskSaver(taskId)
  const [reloaded, setReloaded] = useState<{ task: Task; count: number } | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const close = useCallback(() => navigate({ pathname: '/tasks', search: search.toString() }), [navigate, search])

  useEffect(() => {
    panelRef.current?.focus()
  }, [taskId])

  const data = reloaded?.task.id === taskId ? reloaded.task : task.data

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="task-detail-title"
      className={styles.panel}
      onKeyDown={(e) => {
        // 입력칸·메모 안의 Esc는 닫지 않는다. 진행률 슬라이더(range)는 Esc 동작이 없으니 닫는다
        const typing =
          (e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement
        if (e.key === 'Escape' && !typing) {
          e.preventDefault()
          close()
        }
      }}
    >
      {task.isPending && <Skeleton count={6} />}
      {task.isError && (
        <div className={styles.panelBody}>
          <p role="alert" className={styles.error}>
            {task.error instanceof ApiError && task.error.status === 404
              ? '업무를 찾을 수 없어요'
              : '업무를 불러오지 못했어요'}
          </p>
          <button type="button" className={styles.smallButton} onClick={close}>
            닫기
          </button>
        </div>
      )}
      {data && (
        <>
          {conflict && (
            <div role="alert" className={styles.conflict}>
              <span>다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요</span>
              <button
                type="button"
                className={styles.reload}
                onClick={async () => {
                  const fresh = await reload()
                  if (fresh) setReloaded((prev) => ({ task: fresh, count: (prev?.count ?? 0) + 1 }))
                  // 폼을 다시 만들어 버튼이 사라지므로 패널로 포커스를 옮긴다
                  panelRef.current?.focus()
                }}
              >
                새로 불러오기
              </button>
            </div>
          )}
          <TaskForm key={`${data.id}-${reloaded?.count ?? 0}`} task={data} save={save} onClose={close} />
        </>
      )}
    </aside>
  )
}

function TaskForm({
  task,
  save,
  onClose,
}: {
  task: Task
  save: (patch: Patch) => Promise<SaveResult>
  onClose: () => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const listContext = useOutletContext<TaskListOutletContext | undefined>()
  const { showToast, showUndo } = useToast()
  const projects = useProjects()
  const tags = useTags()
  const archived = Boolean(task.deletedAt)

  const [title, setTitle] = useState(task.title)
  const [savedTitle, setSavedTitle] = useState(task.title)
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [due, setDue] = useState(task.dueDate ?? '')
  const [savedDue, setSavedDue] = useState(task.dueDate ?? '')
  // 키보드로 날짜를 치는 중이면 중간값(예: 1013-06-06)마다 저장하지 않고 blur·Enter에서 한 번 저장한다.
  // 키 입력 없이 바뀌면(달력에서 고름) 바로 저장한다
  const dueTyping = useRef(false)
  // Enter로 보낸 뒤 이어지는 blur가 같은 값을 한 번 더 보내지 않게
  const dueSending = useRef<string | null>(null)
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [tagIds, setTagIds] = useState(task.tagIds)
  const [progress, setProgress] = useState(task.progress)
  const [savedProgress, setSavedProgress] = useState(task.progress)
  const [memo, setMemo] = useState(task.memo ?? '')
  const [savedMemo, setSavedMemo] = useState(task.memo ?? '')
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = async (patch: Patch, after?: () => void) => {
    const result = await save(patch)
    if (result.ok) {
      setError(null)
      after?.()
      return
    }
    // 저장이 거부되면 바꾼 칸을 서버 값으로 되돌린다. 그대로 두면 화면과 서버(목록)가 어긋난다 (P1-03-09)
    if ('status' in patch) setStatus(task.status)
    if ('priority' in patch) setPriority(task.priority)
    if ('dueDate' in patch) setDue(savedDue)
    if ('projectId' in patch) setProjectId(task.projectId ?? '')
    if ('tagIds' in patch) setTagIds(task.tagIds)
    if ('progress' in patch) setProgress(savedProgress)
    if ('memo' in patch) setMemo(savedMemo)
    if ('title' in patch) setTitle(savedTitle)
    if (result.message) setError(result.message)
  }

  const saveTitle = () => {
    const next = title.trim()
    if (next === savedTitle) return
    if (!next) {
      setTitle(savedTitle)
      setError('제목을 적어 주세요')
      return
    }
    void commit({ title: next }, () => setSavedTitle(next))
  }

  const saveDue = (value: string) => {
    dueTyping.current = false
    if (value === savedDue || value === dueSending.current) return
    // 완성되지 않았거나 말이 안 되는 날짜면 저장하지 않고 서버 값으로 되돌린다. 비우면 마감일을 지운다(null)
    if (value && !(isValidDate(value) && value >= '1900-01-01' && value <= '2100-12-31')) {
      setDue(savedDue)
      return
    }
    dueSending.current = value
    void commit({ dueDate: value || null }, () => setSavedDue(value)).finally(() => {
      dueSending.current = null
    })
  }

  const saveTags = (next: string[]) => {
    setTagIds(next)
    void commit({ tagIds: next })
  }

  // 태그를 빼면 누른 ×가 사라지므로 이웃 태그의 ×(없으면 태그 추가 칸)로 포커스를 옮긴다 (P1-03-07)
  const tagEditor = useRef<HTMLDivElement>(null)
  const tagFocus = useRef<string | null>(null)
  useEffect(() => {
    const target = tagFocus.current
    if (target === null) return
    tagFocus.current = null
    const selector = target ? `[data-tag-remove="${target}"]` : 'input'
    tagEditor.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [tagIds])
  const removeTag = (tagId: string) => {
    const index = tagIds.indexOf(tagId)
    const rest = tagIds.filter((x) => x !== tagId)
    tagFocus.current = rest[index] ?? rest[index - 1] ?? ''
    saveTags(rest)
  }

  const addTag = async () => {
    const name = newTag.trim().replace(/^#/, '')
    if (!name) return
    if (!/^[^\s#]{1,30}$/.test(name)) {
      setError('태그는 공백과 # 없이 30자까지예요')
      return
    }
    try {
      const tag = await tagApi.create(name)
      void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
      setNewTag('')
      if (!tagIds.includes(tag.id)) saveTags([...tagIds, tag.id])
    } catch (err) {
      setError(toastForError(err).message)
    }
  }

  const archive = async () => {
    try {
      await taskApi.remove(task.id)
      // 목록에서 행이 빠지면 이웃 행으로 포커스가 가도록 목록에 먼저 알린다
      listContext?.leave(task.id)
      refreshTasks(queryClient)
      onClose()
      showUndo({
        group: 'archive-task',
        message: (n) => `업무 ${n}개를 보관했어요`,
        undo: async () => {
          await taskApi.restore(task.id)
          refreshTasks(queryClient)
        },
      })
    } catch (err) {
      const { message, traceId } = toastForError(err)
      showToast(message, { traceId })
    }
  }

  const restore = async () => {
    try {
      const restored = await taskApi.restore(task.id)
      // [복원] 버튼이 사라지므로 포커스를 제목 칸으로 옮긴다
      document.getElementById(`${id}-title`)?.focus()
      queryClient.setQueryData(taskKey(task.id), restored)
      refreshTasks(queryClient)
      showToast('업무를 복원했어요')
    } catch (err) {
      const { message, traceId } = toastForError(err)
      showToast(message, { traceId })
    }
  }

  const project = projects.data?.find((p) => p.id === projectId)
  const accent = project ? projectColor(project.color).base : 'var(--color-accent)'
  const tagName = new Map((tags.data ?? []).map((t) => [t.id, t.name]))

  return (
    <div className={styles.panelBody}>
      <div className={styles.panelHead}>
        <label htmlFor={`${id}-title`} className={styles.srOnly}>
          제목
        </label>
        <h2 id="task-detail-title" className={styles.srOnly}>
          {task.title}
        </h2>
        <input
          id={`${id}-title`}
          className={styles.titleInput}
          value={title}
          maxLength={200}
          readOnly={archived}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveTitle()
          }}
        />
        <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>

      {archived && (
        <div className={styles.archivedBand}>
          <span>보관한 업무예요. 복원하면 다시 고칠 수 있어요</span>
          <button type="button" className={styles.smallButton} onClick={() => void restore()}>
            복원
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <fieldset className={styles.fields} disabled={archived}>
        <legend className={styles.srOnly}>업무 속성</legend>
        <label htmlFor={`${id}-status`} className={styles.fieldLabel}>
          상태
        </label>
        <select
          id={`${id}-status`}
          className={styles.select}
          value={status}
          onChange={(e) => {
            const next = e.target.value as Task['status']
            setStatus(next)
            void commit({ status: next })
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <label htmlFor={`${id}-priority`} className={styles.fieldLabel}>
          우선순위
        </label>
        <select
          id={`${id}-priority`}
          className={styles.select}
          value={priority}
          onChange={(e) => {
            const next = e.target.value as Task['priority']
            setPriority(next)
            void commit({ priority: next })
          }}
        >
          {(['HIGH', 'NORMAL', 'LOW'] as const).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>

        <label htmlFor={`${id}-due`} className={styles.fieldLabel}>
          마감일
        </label>
        <input
          id={`${id}-due`}
          type="date"
          className={styles.select}
          value={due}
          // fieldset이 막아도 칸 자체도 막는다(값을 직접 넣는 경로까지, P1-03-09)
          disabled={archived}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveDue(e.currentTarget.value)
            else if (e.key !== 'Tab' && e.key !== 'Shift') dueTyping.current = true
          }}
          onChange={(e) => {
            setDue(e.target.value)
            if (!dueTyping.current) saveDue(e.target.value)
          }}
          onBlur={(e) => saveDue(e.currentTarget.value)}
        />

        <label htmlFor={`${id}-project`} className={styles.fieldLabel}>
          프로젝트
        </label>
        <select
          id={`${id}-project`}
          className={styles.select}
          value={projectId}
          // 프로젝트 목록을 받기 전에는 고를 수 없다(받기 전에 '없음'으로 보이지 않게 아래 자리 표시)
          disabled={projects.isPending}
          onChange={(e) => {
            setProjectId(e.target.value)
            void commit({ projectId: e.target.value || null })
          }}
        >
          <option value="">없음</option>
          {projectId && !projects.data && <option value={projectId}>불러오는 중…</option>}
          {(projects.data ?? [])
            .filter((p) => !p.archived || p.id === projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>

        <span id={`${id}-tags`} className={styles.fieldLabel}>
          태그
        </span>
        <div ref={tagEditor} className={styles.tagEditor} role="group" aria-labelledby={`${id}-tags`}>
          {tagIds.map((t) => (
            <span key={t} className={styles.tagChip}>
              #{tagName.get(t) ?? '…'}
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`${tagName.get(t) ?? ''} 태그 빼기`}
                data-tag-remove={t}
                onClick={() => removeTag(t)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className={styles.tagAdd}
            aria-label="태그 추가"
            placeholder="+ 태그"
            maxLength={31}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void addTag()
              }
            }}
          />
        </div>
      </fieldset>

      <fieldset className={styles.block} disabled={archived}>
        <legend className={styles.srOnly}>진행률</legend>
        <label htmlFor={`${id}-progress`} className={styles.progressLabel}>
          진행률 <span style={{ color: accent }}>{progress}%</span>
        </label>
        <input
          id={`${id}-progress`}
          type="range"
          min={0}
          max={100}
          step={10}
          value={progress}
          style={{ accentColor: accent }}
          className={styles.range}
          onChange={(e) => setProgress(Number(e.target.value))}
          // 끌기가 끝나면(손을 떼거나 키를 놓을 때) 저장한다
          onPointerUp={() => progress !== savedProgress && void commit({ progress }, () => setSavedProgress(progress))}
          onKeyUp={() => progress !== savedProgress && void commit({ progress }, () => setSavedProgress(progress))}
          onBlur={() => progress !== savedProgress && void commit({ progress }, () => setSavedProgress(progress))}
        />
      </fieldset>

      <fieldset className={styles.block} disabled={archived}>
        <legend className={styles.srOnly}>메모</legend>
        <label htmlFor={`${id}-memo`} className={styles.fieldLabel}>
          메모
        </label>
        <textarea
          id={`${id}-memo`}
          rows={4}
          maxLength={5000}
          className={styles.memo}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={() => {
            if (memo === savedMemo) return
            void commit({ memo: memo.trim() ? memo : null }, () => setSavedMemo(memo))
          }}
        />
      </fieldset>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <span className={styles.fieldLabel}>연결된 일정</span>
          <Link to="/calendar">캘린더에 배치</Link>
        </div>
        <p className={styles.muted}>{task.hasSchedule ? '캘린더에 배치된 일정이 있어요' : '아직 일정이 없어요'}</p>
      </div>

      {task.carriedOverFromId && <p className={styles.note}>이전 날짜에서 넘어온 업무예요</p>}

      <div className={styles.panelFoot}>
        <span className={styles.muted}>변경 사항은 자동 저장돼요</span>
        {!archived && (
          <button type="button" className={styles.dangerButton} onClick={() => void archive()}>
            보관
          </button>
        )}
      </div>
    </div>
  )
}

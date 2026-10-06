// SCR-TASK-02 업무 상세 (오른쪽 패널, 모바일은 전체 화면). 모든 변경은 항목별 자동 저장이고(저장 버튼 없음),
// 저장은 한 줄로 세워 앞 응답의 version으로 다음 저장을 보낸다. 409는 충돌 띠(2.5), 보관한 업무는 읽기 전용 + 복원.
// 기록 이력(⑥)은 P2, 이월 이력(⑦)은 P3에서 채운다. 연결 일정 목록(⑤)은 업무별 일정 조회 API가 없어 배치 여부와 캘린더 링크만 둔다.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import { TAGS_QUERY_KEY, tagApi, useProjects, useTags } from '../projects/api'
import { projectColor } from '../projects/palette'
import { refreshTasks, taskApi, taskKey, useTask, type Task, type TaskPatch } from './api'
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
        if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault()
          close()
        }
      }}
    >
      {task.isPending && <p className={styles.muted}>불러오는 중…</p>}
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
  const { showToast, showUndo } = useToast()
  const projects = useProjects()
  const tags = useTags()
  const archived = Boolean(task.deletedAt)

  const [title, setTitle] = useState(task.title)
  const [savedTitle, setSavedTitle] = useState(task.title)
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [due, setDue] = useState(task.dueDate ?? '')
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
    } else if (result.message) setError(result.message)
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

  const saveTags = (next: string[]) => {
    setTagIds(next)
    void commit({ tagIds: next })
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
          onChange={(e) => {
            setDue(e.target.value)
            // 비우면 마감일을 지운다(null)
            void commit({ dueDate: e.target.value || null })
          }}
        />

        <label htmlFor={`${id}-project`} className={styles.fieldLabel}>
          프로젝트
        </label>
        <select
          id={`${id}-project`}
          className={styles.select}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value)
            void commit({ projectId: e.target.value || null })
          }}
        >
          <option value="">없음</option>
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
        <div className={styles.tagEditor} role="group" aria-labelledby={`${id}-tags`}>
          {tagIds.map((t) => (
            <span key={t} className={styles.tagChip}>
              #{tagName.get(t) ?? '…'}
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`${tagName.get(t) ?? ''} 태그 빼기`}
                onClick={() => saveTags(tagIds.filter((x) => x !== t))}
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

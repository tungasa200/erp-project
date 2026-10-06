// SCR-SET-08 설정 — 프로젝트·태그 (TASK-04). 프로젝트는 삭제 없이 보관만 하고(되돌리기 토스트), 태그는 이름 변경과 사용 수를 보여 준다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useToast } from '../components/useToast'
import {
  PROJECTS_QUERY_KEY,
  projectApi,
  TAGS_QUERY_KEY,
  tagApi,
  useProjects,
  useTags,
  type Project,
  type ProjectColor,
  type Tag,
} from '../projects/api'
import { nextColor, PROJECT_COLORS, projectColor } from '../projects/palette'
import styles from './projects.module.css'

const TAG_NAME = /^[^\s#]{1,30}$/

export function ProjectSettings() {
  return (
    <div className={styles.stack}>
      <ProjectSection />
      <TagSection />
    </div>
  )
}

function ProjectSection() {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const { data: projects, isPending, isError, refetch } = useProjects()

  const replace = (updated: Project) =>
    queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) =>
      list?.map((p) => (p.id === updated.id ? updated : p)),
    )

  const failed = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      void refetch()
      showToast('다른 곳에서 먼저 수정돼서 새로 불러왔어요. 다시 해 주세요')
    } else {
      showToast(...spread(toastForError(error)))
    }
  }

  const archive = async (project: Project) => {
    try {
      replace(await projectApi.update(project.id, { version: project.version, archived: true }))
    } catch (error) {
      failed(error)
      return
    }
    showUndo({
      group: 'archive-project',
      message: (n) => `프로젝트 ${n}개를 보관했어요`,
      undo: async () => {
        const latest = queryClient.getQueryData<Project[]>(PROJECTS_QUERY_KEY)?.find((p) => p.id === project.id)
        if (!latest) return
        replace(await projectApi.update(project.id, { version: latest.version, archived: false }))
      },
    })
  }

  const active = projects?.filter((p) => !p.archived) ?? []
  const archivedCount = (projects?.length ?? 0) - active.length

  return (
    <section aria-labelledby="settings-projects" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="settings-projects" className={styles.title}>
          프로젝트
        </h2>
        {archivedCount > 0 && <span className={styles.meta}>보관한 프로젝트 {archivedCount}</span>}
      </div>

      {isPending && <p className={styles.muted}>불러오는 중…</p>}
      {isError && (
        <p role="alert" className={styles.error}>
          프로젝트를 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={() => void refetch()}>
            다시 시도
          </button>
        </p>
      )}
      {projects && active.length === 0 && (
        <p className={styles.muted}>아직 프로젝트가 없어요. 아래에서 추가해 보세요.</p>
      )}
      {active.length > 0 && (
        <ul className={styles.list} aria-label="프로젝트 목록">
          {active.map((p) => (
            <li key={p.id} className={styles.item}>
              <span className={styles.swatch} style={{ background: projectColor(p.color).base }} aria-hidden="true" />
              <span className={styles.name}>{p.name}</span>
              <span className={styles.count}>업무 {p.taskCount}</span>
              <button
                type="button"
                className={styles.smallButton}
                aria-label={`${p.name} 보관`}
                onClick={() => void archive(p)}
              >
                보관
              </button>
            </li>
          ))}
        </ul>
      )}

      {projects && (
        <NewProjectForm
          projects={projects}
          onCreated={(p) => queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => [...(list ?? []), p])}
        />
      )}
    </section>
  )
}

// showToast는 (message, options) 순서라 toastForError 결과를 펼쳐 넘긴다.
function spread({ message, traceId }: { message: string; traceId?: string }): [string, { traceId?: string }] {
  return [message, { traceId }]
}

function NewProjectForm({ projects, onCreated }: { projects: Project[]; onCreated: (p: Project) => void }) {
  const id = useId()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  // 고르지 않았으면 아직 안 쓴 색을 기본으로 보여 준다.
  const [picked, setPicked] = useState<ProjectColor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const color = picked ?? nextColor(projects)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('프로젝트 이름을 적어 주세요')
      return
    }
    setSaving(true)
    try {
      onCreated(await projectApi.create({ name: trimmed, color }))
      setName('')
      setPicked(null)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') setError('같은 이름의 프로젝트가 있어요')
      else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setError('이름은 50자까지 쓸 수 있어요')
      else showToast(...spread(toastForError(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.newProject} onSubmit={(e) => void submit(e)} noValidate>
      <label htmlFor={id} className={styles.formLabel}>
        새 프로젝트
      </label>
      <input
        id={id}
        type="text"
        className={styles.input}
        placeholder="프로젝트 이름"
        maxLength={50}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div role="radiogroup" aria-label="프로젝트 색" className={styles.palette}>
        {PROJECT_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === color}
            aria-label={c.name}
            className={styles.colorOption}
            style={{ background: projectColor(c.key).base, color: projectColor(c.key).base }}
            onClick={() => setPicked(c.key)}
          />
        ))}
      </div>
      <p className={styles.muted}>프로젝트 색은 테마를 바꿔도 그대로예요</p>
      <button type="submit" className={styles.primary} disabled={saving}>
        추가
      </button>
    </form>
  )
}

function TagSection() {
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const { data: tags, isPending, isError, refetch } = useTags()

  const headingRef = useRef<HTMLHeadingElement>(null)
  // 지운 뒤 포커스를 둘 곳: 다음 태그의 ✎, 없으면 목록 머리 (P1-02-10)
  const [focusAfterRemove, setFocusAfterRemove] = useState<string | null>(null)
  useEffect(() => {
    if (focusAfterRemove === null) return
    const next = document.querySelector<HTMLButtonElement>(`[data-tag-edit="${focusAfterRemove}"]`)
    ;(next ?? headingRef.current)?.focus()
    setFocusAfterRemove(null)
  }, [focusAfterRemove])

  // 태그 삭제는 되돌릴 수 없는 API라, 화면에서 먼저 빼고 되돌리기 토스트가 닫힐 때 보낸다(P1-02 결정 A안).
  // 새로 고침·탭 닫기 때는 토스트가 keepalive로 바로 확정한다(P1-02-07).
  const remove = (tag: Tag) => {
    const index = tags?.findIndex((t) => t.id === tag.id) ?? -1
    const rest = tags?.filter((t) => t.id !== tag.id) ?? []
    setFocusAfterRemove(rest[index]?.id ?? rest[index - 1]?.id ?? '')
    queryClient.setQueryData<Tag[]>(TAGS_QUERY_KEY, (list) => list?.filter((t) => t.id !== tag.id))
    showUndo({
      group: 'delete-tag',
      message: (n) => `태그 ${n}개를 지웠어요`,
      undo: () => {
        queryClient.setQueryData<Tag[]>(TAGS_QUERY_KEY, (list) =>
          [...(list ?? []), tag].sort((a, b) => a.name.localeCompare(b.name)),
        )
      },
      commit: ({ keepalive }) =>
        void tagApi.remove(tag.id, { keepalive }).catch((error: unknown) => {
          // 이미 지워졌으면(404) 원하던 결과다.
          if (error instanceof ApiError && error.status === 404) return
          void refetch()
          showToast(...spread(toastForError(error)))
        }),
    })
  }

  return (
    <section aria-labelledby="settings-tags" className={styles.panel}>
      <h2 id="settings-tags" ref={headingRef} tabIndex={-1} className={styles.title}>
        태그
      </h2>
      {isPending && <p className={styles.muted}>불러오는 중…</p>}
      {isError && (
        <p role="alert" className={styles.error}>
          태그를 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={() => void refetch()}>
            다시 시도
          </button>
        </p>
      )}
      {tags && tags.length === 0 && <p className={styles.muted}>업무에 태그를 붙이면 여기에 모여요.</p>}
      {tags && tags.length > 0 && (
        <ul className={styles.tags} aria-label="태그 목록">
          {tags.map((t) => (
            <TagChip key={t.id} tag={t} onRemove={() => remove(t)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TagChip({ tag, onRemove }: { tag: Tag; onRemove: () => void }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const editButton = useRef<HTMLButtonElement>(null)
  // Enter·Esc로 편집을 끝내면 ✎로 포커스를 돌려준다. 바깥을 눌러 끝낼 때는 누른 곳에 둔다 (P1-02-10)
  const [returnFocus, setReturnFocus] = useState(false)
  useEffect(() => {
    if (!editing && returnFocus) {
      editButton.current?.focus()
      setReturnFocus(false)
    }
  }, [editing, returnFocus])

  const cancel = (refocus = false) => {
    setEditing(false)
    setName(tag.name)
    setError(null)
    setReturnFocus(refocus)
  }

  const save = async (refocus = false) => {
    const next = name.trim()
    if (next === tag.name) return cancel(refocus)
    if (next === '') {
      setError('태그 이름을 적어 주세요')
      return
    }
    if (!TAG_NAME.test(next)) {
      setError('공백과 #은 쓸 수 없고 30자까지예요')
      return
    }
    try {
      const updated = await tagApi.rename(tag.id, { version: tag.version, name: next })
      queryClient.setQueryData<Tag[]>(TAGS_QUERY_KEY, (list) => list?.map((t) => (t.id === updated.id ? updated : t)))
      setEditing(false)
      setError(null)
      setReturnFocus(refocus)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') setError('같은 이름의 태그가 있어요')
      else if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        void queryClient.refetchQueries({ queryKey: TAGS_QUERY_KEY })
        showToast('다른 곳에서 먼저 수정돼서 새로 불러왔어요. 다시 해 주세요')
        cancel(refocus)
      } else showToast(...spread(toastForError(err)))
    }
  }

  if (!editing) {
    return (
      <li className={styles.tag}>
        <span>#{tag.name}</span>
        <span className={styles.count}>{tag.usageCount}</span>
        <button
          ref={editButton}
          type="button"
          className={styles.iconButton}
          data-tag-edit={tag.id}
          aria-label={`${tag.name} 태그 이름 바꾸기`}
          onClick={() => setEditing(true)}
        >
          ✎
        </button>
      </li>
    )
  }

  return (
    <li
      className={`${styles.tag} ${styles.tagEditing}`}
      // 포커스가 행을 떠날 때만 저장한다. 입력칸 blur로 저장하면 Tab으로 [삭제]에 가는 순간 편집이 닫혀
      // [삭제]가 사라지고 포커스가 BODY로 빠진다 (P1-02-11)
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) void save()
      }}
    >
      <label htmlFor={id} className={styles.srOnly}>
        태그 이름
      </label>
      <span aria-hidden="true">#</span>
      <input
        id={id}
        autoFocus
        className={styles.tagInput}
        value={name}
        maxLength={30}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') void save(true)
          if (e.key === 'Escape') cancel(true)
        }}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <button
        type="button"
        className={styles.tagDelete}
        // 마우스로 눌러도 포커스는 입력칸에 둔다. 지운 뒤에는 TagSection이 이웃 ✎로 옮긴다
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
      >
        삭제
      </button>
      {error && (
        <span id={`${id}-error`} role="alert" className={styles.tagError}>
          {error}
        </span>
      )}
    </li>
  )
}

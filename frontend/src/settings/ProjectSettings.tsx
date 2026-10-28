// SCR-SET-08 설정 — 프로젝트·태그 (TASK-04). 프로젝트는 여기서는 보관만 하고(되돌리기 토스트), 완전히 지우는 것은 보관함의 영구 삭제다(D-226).
// 프로젝트 이름은 태그처럼 그 자리에서 바꾸고, 손잡이로 끌거나 손잡이 메뉴로 순서를 바꾼다(D-240, 사양 docs/ux/프로젝트_이름순서_사양_v1.md).
// 태그는 이름 변경과 사용 수를 보여 준다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { announce } from '../components/announce'
import { focusSectionHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { objectParticle } from '../palette/particle'
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
// 보관한 프로젝트도 겹침에 든다(서버는 보관 여부를 구분하지 않음, 사양 1.3)
const DUPLICATE_PROJECT = '같은 이름의 프로젝트가 있어요. 보관함도 확인해 주세요'
const OFFLINE_TITLE = '연결되면 바꿀 수 있어요'

/** 보관하지 않은 프로젝트를 ids 순서로. ids에 없는 것(새로 만든 것)은 그 뒤, 보관한 것은 맨 뒤 */
function applyOrder(list: Project[] | undefined, ids: string[]) {
  if (!list) return list
  const rank = new Map(ids.map((id, i) => [id, i]))
  const at = (p: Project) => (p.archived ? Infinity : (rank.get(p.id) ?? ids.length))
  return [...list].sort((a, b) => at(a) - at(b))
}

/** 끄는 중: 떠오른 줄의 이동 거리, 놓을 자리(보관 안 한 목록 안 번호, 목록 밖이면 null), 빈 칸·선 위치(목록 틀 기준 px) */
interface Drag {
  id: string
  dy: number
  target: number | null
  slot: { top: number; height: number }
  line: number | null
}

interface DragHandlers {
  down: (e: ReactPointerEvent<HTMLButtonElement>, project: Project) => void
  move: (e: ReactPointerEvent<HTMLButtonElement>) => void
  /** 끌었으면 true(뒤따르는 click은 메뉴를 열지 않는다) */
  up: (e: ReactPointerEvent<HTMLButtonElement>) => boolean
  cancel: () => void
}

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
  const online = useOnline()
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
    const index = active.findIndex((p) => p.id === project.id)
    const next = active[index + 1] ?? active[index - 1]
    focusAfter.current = { gone: project.id, next: next?.id ?? null }
    try {
      replace(await projectApi.update(project.id, { version: project.version, archived: true }))
    } catch (error) {
      focusAfter.current = null
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

  // 보관하면 행이 목록에서 빠지므로 이웃 프로젝트의 [보관](없으면 제목)으로 포커스를 옮긴다
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<{ gone: string; next: string | null } | null>(null)
  useEffect(() => {
    const pending = focusAfter.current
    if (!pending || projects?.some((p) => p.id === pending.gone && !p.archived)) return
    focusAfter.current = null
    const next = pending.next && document.querySelector<HTMLElement>(`[data-project-archive="${pending.next}"]`)
    ;(next || headingRef.current)?.focus()
  }, [projects])

  // 옮긴 줄(성공·실패 모두)의 손잡이로 포커스를 둔다. 줄이 DOM에서 자리를 옮기면 포커스가 빠지는 브라우저가 있다
  const focusHandle = useRef<string | null>(null)
  useEffect(() => {
    const id = focusHandle.current
    if (!id) return
    focusHandle.current = null
    document.querySelector<HTMLElement>(`[data-project-handle="${id}"]`)?.focus()
  }, [projects])

  // 놓거나 메뉴로 옮긴 줄에 0.8초 옅은 면
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  // 순서 저장(사양 2.4): 화면을 먼저 바꾸고 전체 순서를 보낸다. 보내는 중에 또 옮기면 끝난 뒤 마지막 순서만 한 번 더 보낸다.
  // 실패하면 마지막으로 저장된 순서(savedOrder)로 되돌린다
  const savedOrder = useRef<string[]>([])
  const sending = useRef(false)
  const queued = useRef<{ ids: string[]; id: string; message: string } | null>(null)
  const sendOrder = async (ids: string[], id: string, message: string) => {
    if (sending.current) {
      queued.current = { ids, id, message }
      return
    }
    sending.current = true
    try {
      await projectApi.order(ids)
      savedOrder.current = ids
      // 성공은 토스트 없이 낭독기에만(Q4). 연달아 옮겼으면 마지막 것만 알린다
      if (!queued.current) announce(message)
    } catch (error) {
      queued.current = null
      focusHandle.current = id
      if (error instanceof ApiError && error.code === 'PROJECT_ORDER_STALE') {
        void refetch()
        showToast('프로젝트 목록이 바뀌었어요. 목록을 새로 불러왔어요')
      } else {
        queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => applyOrder(list, savedOrder.current))
        showToast('순서를 저장하지 못했어요. 다시 해 주세요', { traceId: toastForError(error).traceId })
      }
    } finally {
      sending.current = false
    }
    const next = queued.current
    if (next) {
      queued.current = null
      void sendOrder(next.ids, next.id, next.message)
    }
  }

  const move = (project: Project, to: number) => {
    const ids = active.map((p) => p.id)
    const from = ids.indexOf(project.id)
    if (from < 0 || from === to) return
    if (!sending.current) savedOrder.current = [...ids]
    ids.splice(from, 1)
    ids.splice(to, 0, project.id)
    focusHandle.current = project.id
    queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => applyOrder(list, ids))
    setFlashId(project.id)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashId(null), 800)
    const message = `${project.name}${objectParticle(project.name)} ${ids.length}개 중 ${to + 1}번째로 옮겼어요`
    void sendOrder(ids, project.id, message)
  }

  // 끌기(사양 2.2, 손잡이에서만): 6px 넘게 움직이면 시작. 원래 자리는 빈 칸, 놓을 자리는 키 색 선. 목록 밖에서 놓거나 Esc면 취소
  const wrapRef = useRef<HTMLDivElement>(null)
  // cancelled: Esc로 취소한 뒤에도 손을 뗄 때까지 남겨, 따라오는 click이 메뉴를 열지 않게 한다
  const press = useRef<{
    project: Project
    pointerId: number
    y: number
    scroll: number
    moved: boolean
    cancelled?: boolean
  } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const showDrag = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (press.current) press.current.cancelled = true
      showDrag(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dragging])

  const dragHandlers: DragHandlers = {
    down: (e, project) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      press.current = { project, pointerId: e.pointerId, y: e.clientY, scroll: window.scrollY, moved: false }
    },
    move: (e) => {
      const pressed = press.current
      const wrap = wrapRef.current
      if (!pressed || pressed.cancelled || !wrap || e.pointerId !== pressed.pointerId) return
      const dy = e.clientY - pressed.y + window.scrollY - pressed.scroll
      if (!pressed.moved && Math.abs(dy) <= 6) return
      pressed.moved = true
      // 화면 위·아래 끝 40px 안에서는 천천히 굴린다
      if (e.clientY < 40) window.scrollBy(0, -8)
      else if (e.clientY > window.innerHeight - 40) window.scrollBy(0, 8)
      const rows = [...wrap.querySelectorAll<HTMLElement>('[data-project-row]')]
      const self = rows.find((row) => row.dataset.projectRow === pressed.project.id)
      if (!self) return
      const others = rows.filter((row) => row !== self).map((row) => row.getBoundingClientRect())
      const box = wrap.getBoundingClientRect()
      const inside =
        e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top - 24 && e.clientY <= box.bottom + 24
      const target = inside ? others.filter((b) => b.top + b.height / 2 < e.clientY).length : null
      const edge = target === null ? null : target === 0 ? others[0]?.top : others[target - 1].bottom
      showDrag({
        id: pressed.project.id,
        dy,
        target,
        slot: { top: self.offsetTop, height: self.offsetHeight },
        line: edge == null ? null : edge - box.top,
      })
    },
    up: (e) => {
      const pressed = press.current
      if (!pressed || e.pointerId !== pressed.pointerId) return false
      const target = dragRef.current?.target
      press.current = null
      showDrag(null)
      if (pressed.moved && target != null) move(pressed.project, target)
      return pressed.moved
    },
    cancel: () => {
      press.current = null
      showDrag(null)
    },
  }

  return (
    <section aria-labelledby="settings-projects" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="settings-projects" ref={headingRef} tabIndex={-1} className={styles.title}>
          프로젝트
        </h2>
        {archivedCount > 0 && (
          // SCR-TASK-04 보관함의 프로젝트 탭(P4-10)
          <Link to="/tasks/archive?type=projects" className={`${styles.meta} ${styles.metaLink}`}>
            보관한 프로젝트 {archivedCount}
          </Link>
        )}
      </div>

      {isPending && <Skeleton count={3} />}
      {isError && (
        <p role="alert" className={styles.error}>
          프로젝트를 불러오지 못했어요
          <button
            type="button"
            className={styles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              void refetch()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {projects && active.length === 0 && (
        <p className={styles.muted}>아직 프로젝트가 없어요. 아래에서 추가해 보세요.</p>
      )}
      {active.length > 1 && (
        <p className={styles.muted}>손잡이 ⠿를 끌거나 눌러서 순서를 바꿔요. 사이드바와 필터가 이 순서를 따라요.</p>
      )}
      {active.length > 0 && (
        <div ref={wrapRef} className={styles.listWrap}>
          <ul className={styles.list} aria-label="프로젝트 목록">
            {active.map((p, index) => (
              <ProjectRow
                key={p.id}
                project={p}
                index={index}
                count={active.length}
                online={online}
                flash={flashId === p.id}
                dy={drag?.id === p.id ? drag.dy : null}
                dragHandlers={dragHandlers}
                onMove={(to) => move(p, to)}
                onArchive={() => void archive(p)}
                onRenamed={replace}
                onFailed={failed}
              />
            ))}
          </ul>
          {drag && (
            <span className={styles.slot} style={{ top: drag.slot.top, height: drag.slot.height }} aria-hidden="true" />
          )}
          {drag?.line != null && <span className={styles.dropLine} style={{ top: drag.line }} aria-hidden="true" />}
        </div>
      )}
      {active.length > 0 && (
        // [보관]이 무엇을 하는지(D-226 ④, D-59 '보관만'을 바꿈)
        <p id="settings-projects-archive-note" className={`${styles.muted} ${styles.keepWords}`}>
          보관한 프로젝트는 <Link to="/tasks/archive?type=projects">보관함</Link>에서 되돌릴 수 있어요. 완전히 지우려면
          보관함에서 영구 삭제하세요.
        </p>
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

interface ProjectRowProps {
  project: Project
  index: number
  count: number
  online: boolean
  flash: boolean
  /** 끄는 중인 줄이면 떠오른 거리 */
  dy: number | null
  dragHandlers: DragHandlers
  onMove: (to: number) => void
  onArchive: () => void
  onRenamed: (project: Project) => void
  onFailed: (error: unknown) => void
}

// 줄: 손잡이 ⠿ · 색 · 이름 · 업무 n · [✎] · [보관]. 이름 편집은 태그 칩과 같은 방식(사양 1)
function ProjectRow({
  project,
  index,
  count,
  online,
  flash,
  dy,
  dragHandlers,
  onMove,
  onArchive,
  onRenamed,
  onFailed,
}: ProjectRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const saving = useRef(false)
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  // Enter·Esc로 끝내면 ✎로 포커스를 돌려준다. 바깥을 눌러 끝낼 때는 누른 곳에 둔다
  const returnFocus = useRef(false)
  useEffect(() => {
    if (editing) input.current?.select()
    else if (returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])

  const close = (refocus: boolean) => {
    returnFocus.current = refocus
    setEditing(false)
    setError(null)
  }

  const save = async (refocus = false) => {
    if (saving.current) return
    const next = name.trim()
    // 대소문자만 바꾸는 것은 바뀐 이름으로 보고 보낸다(사양 1.3)
    if (next === project.name) return close(refocus)
    if (!next) {
      setError('프로젝트 이름을 적어 주세요')
      return
    }
    saving.current = true
    const timer = window.setTimeout(() => setSlow(true), 400)
    try {
      onRenamed(await projectApi.update(project.id, { version: project.version, name: next }))
      close(refocus)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') setError(DUPLICATE_PROJECT)
      else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setError('이름은 50자까지 쓸 수 있어요')
      else {
        // 다른 곳에서 먼저 바뀌었으면 새로 불러오고 편집을 닫는다. 그 밖의 실패는 편집을 열어 둔다
        onFailed(err)
        if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') close(refocus)
      }
    } finally {
      window.clearTimeout(timer)
      saving.current = false
      setSlow(false)
    }
  }

  const lifted = dy !== null
  const className = [styles.item, lifted && styles.lifted, flash && styles.flash].filter(Boolean).join(' ')

  return (
    <li
      data-project-row={project.id}
      className={className}
      style={lifted ? { transform: `translateY(${dy}px)` } : undefined}
      // 포커스가 줄을 떠날 때만 저장한다(Tab으로 [보관]에 가도 편집은 열려 있다). 오류가 있으면 닫지 않는다
      onBlur={
        editing
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && !error) void save()
            }
          : undefined
      }
    >
      {count > 1 && (
        <MoveHandle
          project={project}
          index={index}
          count={count}
          online={online}
          editing={editing}
          dragHandlers={dragHandlers}
          onMove={onMove}
        />
      )}
      <span className={styles.swatch} style={{ background: projectColor(project.color).base }} aria-hidden="true" />
      {editing ? (
        <>
          <label htmlFor={id} className="visually-hidden">
            프로젝트 이름
          </label>
          <input
            ref={input}
            id={id}
            autoFocus
            className={styles.nameInput}
            value={name}
            maxLength={50}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              // 포커스가 같은 키 안에서 ✎로 돌아가므로, 기본 동작을 막아 ✎가 다시 눌리지 않게 한다
              if (e.key === 'Enter') {
                e.preventDefault()
                void save(true)
              }
              if (e.key === 'Escape') close(true)
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-busy={slow || undefined}
          />
          {slow && <span className={styles.spinner} aria-hidden="true" />}
        </>
      ) : (
        <span className={styles.name}>{project.name}</span>
      )}
      <span className={styles.count}>업무 {project.taskCount}</span>
      {!editing && (
        <button
          ref={editButton}
          type="button"
          className={`${styles.iconButton} ${styles.rowIconButton}`}
          aria-label={`${project.name} 프로젝트 이름 바꾸기`}
          title={online ? undefined : OFFLINE_TITLE}
          disabled={!online}
          onClick={() => {
            setName(project.name)
            setEditing(true)
          }}
        >
          <span aria-hidden="true">✎</span>
        </button>
      )}
      <button
        type="button"
        className={styles.smallButton}
        aria-label={`${project.name} 보관`}
        aria-describedby="settings-projects-archive-note"
        data-project-archive={project.id}
        title={online ? undefined : OFFLINE_TITLE}
        disabled={!online}
        onClick={onArchive}
      >
        보관
      </button>
      {error && (
        <span id={`${id}-error`} role="alert" className={styles.rowError}>
          {error}
        </span>
      )}
    </li>
  )
}

const GRIP = (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="3.5" r="1.4" />
    <circle cx="10.5" cy="3.5" r="1.4" />
    <circle cx="5.5" cy="8" r="1.4" />
    <circle cx="10.5" cy="8" r="1.4" />
    <circle cx="5.5" cy="12.5" r="1.4" />
    <circle cx="10.5" cy="12.5" r="1.4" />
  </svg>
)

// 손잡이 = 버튼(사양 2.1·2.3): 누르면 옮기기 메뉴, 누른 채 움직이면 끌기. 메뉴는 업무 줄 [⋯]과 같은 팝오버
function MoveHandle({
  project,
  index,
  count,
  online,
  editing,
  dragHandlers,
  onMove,
}: Pick<ProjectRowProps, 'project' | 'index' | 'count' | 'online' | 'dragHandlers' | 'onMove'> & { editing: boolean }) {
  const [open, setOpen] = useState(false)
  // 화면 아래 끝에 가까우면 손잡이 위로 연다
  const [above, setAbove] = useState(false)
  const menuId = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const dragged = useRef(false)
  const off = !online || editing
  if (open && off) setOpen(false)

  const items = [
    { label: '위로 옮기기', to: index - 1, disabled: index === 0 },
    { label: '아래로 옮기기', to: index + 1, disabled: index === count - 1 },
    { label: '맨 위로', to: 0, disabled: index === 0 },
    { label: '맨 아래로', to: count - 1, disabled: index === count - 1 },
  ]
  const enabled = () => [
    ...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
  ]

  useEffect(() => {
    if (!open) return
    enabled()[0]?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const closeMenu = () => {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <span
      ref={wrap}
      className={styles.handleWrap}
      onKeyDown={(e) => {
        if (!open) return
        if (e.key === 'Escape') {
          e.stopPropagation()
          closeMenu()
          return
        }
        const list = enabled()
        const at = list.indexOf(document.activeElement as HTMLElement)
        const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
        if (step !== undefined && at >= 0) {
          e.preventDefault()
          list[(at + step + list.length) % list.length]?.focus()
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          list.at(e.key === 'Home' ? 0 : -1)?.focus()
        }
      }}
      // Tab 등으로 메뉴 밖에 포커스가 가면 닫는다
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.handle}
        data-project-handle={project.id}
        aria-label={`${project.name} 순서 바꾸기, ${count}개 중 ${index + 1}번째`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={online ? undefined : OFFLINE_TITLE}
        disabled={off}
        onPointerDown={(e) => {
          dragged.current = false
          dragHandlers.down(e, project)
        }}
        onPointerMove={dragHandlers.move}
        onPointerUp={(e) => {
          dragged.current = dragHandlers.up(e)
        }}
        onPointerCancel={dragHandlers.cancel}
        onClick={(e) => {
          // 끌고 놓은 뒤 따라오는 click은 메뉴를 열지 않는다(키보드 click은 detail 0)
          if (e.detail !== 0 && dragged.current) return
          if (!open) setAbove(e.currentTarget.getBoundingClientRect().bottom + 220 > window.innerHeight)
          setOpen((o) => !o)
        }}
      >
        {GRIP}
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={`${project.name} 순서 바꾸기`}
          className={`${styles.moveMenu} ${above ? styles.moveMenuAbove : ''}`}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={styles.moveMenuItem}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  onMove(item.to)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
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
    if (saving) return
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
      if (err instanceof ApiError && err.code === 'DUPLICATE_NAME') setError(DUPLICATE_PROJECT)
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
      <button type="submit" className={styles.primary} aria-disabled={saving}>
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
      {isPending && <Skeleton shape="chip" count={5} />}
      {isError && (
        <p role="alert" className={styles.error}>
          태그를 불러오지 못했어요
          <button
            type="button"
            className={styles.smallButton}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              void refetch()
            }}
          >
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
  const online = useOnline()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)
  // 저장 중 Enter·blur가 겹쳐도 한 번만 보낸다. 0.4초 넘으면 스피너(프로젝트 이름과 같게)
  const [slow, setSlow] = useState(false)
  const saving = useRef(false)
  const id = useId()
  const editButton = useRef<HTMLButtonElement>(null)
  // 편집을 열면 글자를 전체 선택한다(프로젝트 이름과 같게, 사양 1.2)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
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
    if (saving.current) return
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
    saving.current = true
    const timer = window.setTimeout(() => setSlow(true), 400)
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
    } finally {
      window.clearTimeout(timer)
      saving.current = false
      setSlow(false)
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
          title={online ? undefined : OFFLINE_TITLE}
          disabled={!online}
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
      <label htmlFor={id} className="visually-hidden">
        태그 이름
      </label>
      <span aria-hidden="true">#</span>
      <input
        ref={input}
        id={id}
        autoFocus
        className={styles.tagInput}
        value={name}
        maxLength={30}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          // 프로젝트 이름 칸과 같게: 포커스가 같은 키 안에서 ✎로 돌아가므로 ✎가 다시 눌리지 않게 막는다
          if (e.key === 'Enter') {
            e.preventDefault()
            void save(true)
          }
          if (e.key === 'Escape') cancel(true)
        }}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-busy={slow || undefined}
      />
      {slow && <span className={`${styles.spinner} ${styles.tagSpinner}`} aria-hidden="true" />}
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

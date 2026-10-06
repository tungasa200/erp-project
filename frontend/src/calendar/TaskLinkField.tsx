// 일정 상세 ④ 연결 업무 (SCR-CAL-07, P1-05-06): 검색해 연결 / 새 업무 / 해제. 프로젝트는 업무를 따른다(D-73).
// 값은 업무 id만 바꾸고, 저장은 모달의 [저장]이 한다. 반복 일정은 시리즈 전체에 연결된다(D-71).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { toastForError } from '../api/errorToast'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { refreshTasks, taskApi, taskListKey, useTask, type TaskFilter } from '../tasks/api'
import styles from './calendar.module.css'
import link from './taskLink.module.css'

const SEARCH_DELAY_MS = 250
const SEARCH_LIMIT = 8

interface Props {
  taskId: string | null
  onChange: (taskId: string | null) => void
  recurring: boolean
}

export function TaskLinkField({ taskId, onChange, recurring }: Props) {
  const id = useId()
  return (
    <div className={styles.field}>
      <span id={`${id}-label`}>연결 업무</span>
      {taskId ? (
        <Linked taskId={taskId} labelId={`${id}-label`} onUnlink={() => onChange(null)} />
      ) : (
        <Search labelId={`${id}-label`} onPick={onChange} />
      )}
      {recurring && <span className={styles.muted}>반복 일정은 모든 회차에 연결돼요</span>}
    </div>
  )
}

function Linked({ taskId, labelId, onUnlink }: { taskId: string; labelId: string; onUnlink: () => void }) {
  const task = useTask(taskId)
  return (
    <div className={link.linked} role="group" aria-labelledby={labelId}>
      {task.isPending ? (
        <Skeleton shape="line" />
      ) : (
        <Link className={styles.link} to={`/tasks/${taskId}`}>
          {task.data?.title ?? '삭제된 업무'}
        </Link>
      )}
      <button type="button" className={styles.secondary} onClick={onUnlink}>
        해제
      </button>
    </div>
  )
}

function Search({ labelId, onPick }: { labelId: string; onPick: (taskId: string) => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)

  // 입력을 멈추면 검색한다
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])
  const filter: TaskFilter = { q, limit: SEARCH_LIMIT }
  const results = useQuery({
    queryKey: taskListKey(filter),
    queryFn: () => taskApi.list(filter),
    enabled: q.length > 0,
  })
  const items = results.data?.items ?? []
  const expanded = open && q.length > 0 && items.length > 0

  const pick = (taskId: string) => {
    setOpen(false)
    onPick(taskId)
  }

  const createTask = async () => {
    const title = text.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      const task = await taskApi.create({ title })
      refreshTasks(queryClient)
      onPick(task.id)
    } catch (error) {
      const { message, traceId } = toastForError(error)
      showToast(message, { traceId })
    } finally {
      setCreating(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (items.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (e.key === 'Enter') {
      // 모달 폼 저장이 아니라 고르기
      e.preventDefault()
      if (expanded && items[active]) pick(items[active].id)
    } else if (e.key === 'Escape' && expanded) {
      // 모달을 닫지 않고 목록만 닫는다
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className={link.search}>
      <div className={link.row}>
        <input
          className={styles.input}
          role="combobox"
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
          placeholder="업무 이름으로 찾기"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        <button
          type="button"
          className={styles.secondary}
          disabled={!text.trim() || creating}
          onClick={() => void createTask()}
        >
          새 업무
        </button>
      </div>
      <ul id={`${id}-list`} role="listbox" aria-labelledby={labelId} className={link.list} hidden={!expanded}>
        {expanded &&
          items.map((t, i) => (
            <li
              key={t.id}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={link.option}
              // 입력 칸 blur보다 먼저 고른다
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(t.id)}
            >
              {t.title}
            </li>
          ))}
      </ul>
      {open && q.length > 0 && results.isSuccess && items.length === 0 && (
        <p className={styles.muted} role="status">
          맞는 업무가 없어요. [새 업무]로 만들어 연결할 수 있어요
        </p>
      )}
    </div>
  )
}

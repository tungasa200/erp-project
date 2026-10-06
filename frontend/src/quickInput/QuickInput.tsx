// SCR-COM-02 빠른 입력창. 입력하는 동안 해석 결과를 칩으로 미리 보여 준다(오해석 방지).
// @프로젝트는 그 프로젝트 색 칩, 없는 프로젝트는 "새 프로젝트 만들기" 칩(눌러서 확인 후 생성).
// #태그는 태그마다 칩 하나, 없는 태그는 저장할 때 만들어지므로 "새" 표시만 한다(P1-02 결정 B안, erp-design 칩 기준).
// 저장(onSubmit)은 업무·일정 API가 생기면(P1-03·05) 연결한다. 칩 수정 드롭다운, 자주 하는 업무 제안(④)도 그때 붙인다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { PROJECTS_QUERY_KEY, projectApi, TAGS_QUERY_KEY, tagApi, type Project, type Tag } from '../projects/api'
import { nextColor, projectColor } from '../projects/palette'
import { useShortcutsEnabled } from '../shortcuts/useShortcuts'
import { shortDate, todayIn, weekStartNumber } from './dates'
import { GrammarHelp } from './GrammarHelp'
import { parseQuickInput, toDraft, type Priority, type QuickDraft } from './parse'
import styles from './QuickInput.module.css'

const PRIORITY_LABEL: Record<Priority, string> = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' }

type Chip =
  | { key: string; kind: 'time' | 'priority' | 'due'; text: string; strong?: boolean }
  | { key: string; kind: 'project'; text: string; project?: Project }
  | { key: string; kind: 'newProject'; name: string }
  | { key: string; kind: 'tag'; name: string; isNew: boolean }

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function chipsOf(draft: QuickDraft, today: string, projects?: Project[], tags?: Tag[]): Chip[] {
  const day = (date: string) => (date === today ? '오늘' : shortDate(date))
  const chips: Chip[] = []
  if (draft.schedule) {
    const { date, start, end } = draft.schedule
    chips.push({ key: 'time', kind: 'time', text: `${day(date)} ${start}–${end}` })
  }
  if (draft.project) {
    const name = draft.project
    const project = projects?.find((p) => sameName(p.name, name))
    // 목록을 아직 못 받았으면 새 프로젝트로 단정하지 않고 이름만 보여 준다.
    if (projects && !project) chips.push({ key: 'project', kind: 'newProject', name })
    else chips.push({ key: 'project', kind: 'project', text: project?.name ?? name, project })
  }
  for (const name of draft.tags ?? []) {
    const isNew = tags !== undefined && !tags.some((t) => sameName(t.name, name))
    chips.push({ key: `tag-${name}`, kind: 'tag', name, isNew })
  }
  if (draft.priority) {
    chips.push({
      key: 'priority',
      kind: 'priority',
      text: `우선순위 ${PRIORITY_LABEL[draft.priority]}`,
      strong: draft.priority === 'HIGH',
    })
  }
  if (draft.due) chips.push({ key: 'due', kind: 'due', text: `마감 ${day(draft.due)}` })
  return chips
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit?: (draft: QuickDraft) => void | Promise<void>
  label?: string
  /** 좁은 곳(캘린더 업무 패널 등)에서 짧은 안내로 바꿀 때 */
  placeholder?: string
}

export function QuickInput({
  value,
  onChange,
  onSubmit,
  label = '빠른 입력',
  placeholder = '무엇을 하셨나요? 한 줄로 적어 보세요',
}: Props) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // Esc로 닫으면 포커스를 ? 버튼으로 돌려준다. 바깥을 눌러 닫을 때는 누른 곳에 포커스를 둔다.
  const closeHelp = useCallback((by: 'escape' | 'outside') => {
    setHelpOpen(false)
    if (by === 'escape') helpButtonRef.current?.focus()
  }, [])
  const id = useId()

  const today = todayIn(user?.timezone ?? 'Asia/Seoul')
  const weekStart = weekStartNumber(user?.weekStart)
  const draft = useMemo(() => toDraft(parseQuickInput(value, { today, weekStart }), today), [value, today, weekStart])
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const shortcutsEnabled = useShortcutsEnabled()
  // @·#을 쓸 때만 목록을 받는다. 자주 바뀌지 않으므로 30초 동안은 다시 받지 않는다.
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: async () => (await projectApi.list()).items,
    enabled: Boolean(draft.project),
    staleTime: 30_000,
  })
  const tags = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: async () => (await tagApi.list()).items,
    enabled: Boolean(draft.tags?.length),
    staleTime: 30_000,
  })
  const chips = chipsOf(draft, today, projects.data, tags.data)
  const typing = value.trim() !== ''

  const createProject = async (name: string) => {
    // 만들면 이 칩이 프로젝트 칩으로 바뀌어 사라지므로 입력창으로 포커스를 돌려준다
    inputRef.current?.focus()
    try {
      const created = await projectApi.create({ name, color: nextColor(projects.data ?? []) })
      queryClient.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (list) => [...(list ?? []), created])
    } catch (error) {
      // 다른 곳에서 먼저 만들었으면 목록을 다시 받아 그 프로젝트로 보여 준다.
      if (error instanceof ApiError && error.code === 'DUPLICATE_NAME') void projects.refetch()
      else {
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter는 조합 확정이라 저장하지 않는다.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      onChange('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!onSubmit || draft.title === '') return
      // 저장에 실패하면(onSubmit이 거부) 입력을 그대로 남긴다. 오류 안내는 onSubmit 쪽이 맡는다.
      void Promise.resolve(onSubmit(draft)).then(
        () => onChange(''),
        () => {},
      )
    }
  }

  return (
    <div className={styles.wrap}>
      <label htmlFor={id} className={styles.srOnly}>
        {label}
      </label>
      <div
        className={styles.field}
        // 알약의 빈 곳(여백·N 안내)을 눌러도 입력칸으로 포커스. 버튼·입력칸을 누른 것은 그대로 둔다
        onMouseDown={(e) => {
          if ((e.target as Element).closest('button, input')) return
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          className={styles.input}
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby={typing ? `${id}-preview` : undefined}
          data-quick-input
        />
        {typing && onSubmit ? (
          <span className={styles.enter}>Enter 저장</span>
        ) : (
          // 단축키를 끄면 N 안내도 숨긴다 (qa P1-01-11)
          shortcutsEnabled && (
            <kbd className={styles.kbd} aria-hidden="true">
              N
            </kbd>
          )
        )}
        <button
          type="button"
          ref={helpButtonRef}
          className={styles.help}
          aria-label="문법 도움말"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          ?
        </button>
      </div>

      {typing && (
        <div id={`${id}-preview`} className={styles.preview}>
          {chips.length > 0 && (
            <ul className={styles.chips} aria-label="해석 결과">
              {chips.map((c) => {
                if (c.kind === 'newProject') {
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        className={`${styles.chip} ${styles.newProject}`}
                        onClick={() => void createProject(c.name)}
                      >
                        + 새 프로젝트 "{c.name}" 만들기
                      </button>
                    </li>
                  )
                }
                if (c.kind === 'tag') {
                  return (
                    <li
                      key={c.key}
                      className={[styles.chip, styles.tag, c.isNew && styles.tagNew].filter(Boolean).join(' ')}
                      aria-label={c.isNew ? `새 태그 ${c.name}` : undefined}
                    >
                      #{c.name}
                      {c.isNew && (
                        <span className={styles.newBadge} aria-hidden="true">
                          새
                        </span>
                      )}
                    </li>
                  )
                }
                if (c.kind === 'project') {
                  const color = c.project && projectColor(c.project.color)
                  return (
                    <li
                      key={c.key}
                      className={`${styles.chip} ${styles.project}`}
                      style={color && { background: color.tint, color: color.ink }}
                    >
                      {c.text}
                    </li>
                  )
                }
                return (
                  <li
                    key={c.key}
                    className={[styles.chip, styles[c.kind], c.strong && styles.strong].filter(Boolean).join(' ')}
                  >
                    {c.text}
                  </li>
                )
              })}
            </ul>
          )}
          <p className={styles.hint}>
            {draft.title === ''
              ? '할 일 이름을 적어 주세요'
              : draft.schedule
                ? '일정과 업무가 함께 만들어져요'
                : '업무가 만들어져요'}
          </p>
        </div>
      )}

      {helpOpen && (
        <GrammarHelp
          onClose={closeHelp}
          onPick={(example) => {
            onChange(example)
            setHelpOpen(false)
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

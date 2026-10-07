// SCR-COM-02 빠른 입력창. 입력하는 동안 해석 결과를 칩으로 미리 보여 준다(오해석 방지).
// @프로젝트는 그 프로젝트 색 칩, 없는 프로젝트는 "새 프로젝트 만들기" 칩(눌러서 확인 후 생성).
// #태그는 태그마다 칩 하나, 없는 태그는 저장할 때 만들어지므로 "새" 표시만 한다(P1-02 결정 B안, erp-design 칩 기준).
// 칩을 누르면 그 값만 고치는 드롭다운이 열린다(P1-09-12, ChipEditor). 자주 하는 업무 제안(④)은 P1-09-10에서 붙인다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { PROJECTS_QUERY_KEY, projectApi, TAGS_QUERY_KEY, tagApi, type Project, type Tag } from '../projects/api'
import { nextColor, projectColor } from '../projects/palette'
import { useShortcutsEnabled } from '../shortcuts/useShortcuts'
import { ChipEditor, type ChipEdit } from './ChipEditor'
import { addDays, isoWeekday, shortDate, todayIn, weekStartNumber } from './dates'
import { GrammarHelp } from './GrammarHelp'
import {
  parseQuickInput,
  replaceSpan,
  toDraft,
  type Priority,
  type QuickDraft,
  type QuickSpans,
  type Span,
} from './parse'
import styles from './QuickInput.module.css'

const PRIORITY_LABEL: Record<Priority, string> = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' }

/** 고칠 수 있는 칩: span은 원문에서 그 칩의 낱말 자리, edit는 드롭다운에 보일 선택지 */
type Editable = { span: Span; edit: ChipEdit }

type Chip =
  | ({ key: string; kind: 'time' | 'priority' | 'due'; text: string; strong?: boolean } & Editable)
  | ({ key: string; kind: 'project'; text: string; project?: Project } & Editable)
  | { key: string; kind: 'newProject'; name: string }
  | ({ key: string; kind: 'tag'; name: string; isNew: boolean } & Editable)

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
const TAG_OPTIONS_MAX = 6

/** 마감 선택지: 오늘·내일·모레·가까운 금요일·다음 월요일 (같은 날이면 하나만) */
function dueOptions(today: string, current: string) {
  const weekday = isoWeekday(today)
  const picks: [string, string][] = [
    ['오늘', today],
    ['내일', addDays(today, 1)],
    ['모레', addDays(today, 2)],
    ['금요일', addDays(today, (5 - weekday + 7) % 7)],
    ['다음 월요일', addDays(today, 8 - weekday)],
  ]
  return picks
    .filter(([, date], i) => picks.findIndex(([, d]) => d === date) === i)
    .map(([label, date]) => ({
      label,
      detail: shortDate(date),
      value: `~${monthDay(date)}`,
      current: date === current,
    }))
}

function chipsOf(draft: QuickDraft, spans: QuickSpans, today: string, projects?: Project[], tags?: Tag[]): Chip[] {
  const day = (date: string) => (date === today ? '오늘' : shortDate(date))
  const chips: Chip[] = []
  if (draft.schedule && spans.time) {
    const { date, start, end } = draft.schedule
    chips.push({
      key: 'time',
      kind: 'time',
      text: `${day(date)} ${start}–${end}`,
      span: spans.time,
      edit: { kind: 'time', title: '시간 고치기', start, end, removeLabel: '시간 빼기' },
    })
  }
  if (draft.project && spans.project) {
    const name = draft.project
    const project = projects?.find((p) => sameName(p.name, name))
    // 목록을 아직 못 받았으면 새 프로젝트로 단정하지 않고 이름만 보여 준다.
    if (projects && !project) chips.push({ key: 'project', kind: 'newProject', name })
    else {
      // 이름에 공백이 있는 프로젝트는 @이름 한 낱말로 쓸 수 없어 선택지에서 뺀다
      const options = (projects ?? [])
        .filter((p) => !p.archived && !/\s/.test(p.name))
        .map((p) => ({ label: p.name, value: `@${p.name}`, current: p.id === project?.id }))
      chips.push({
        key: 'project',
        kind: 'project',
        text: project?.name ?? name,
        project,
        span: spans.project,
        edit: { kind: 'options', title: '프로젝트 고치기', options, removeLabel: '프로젝트 빼기' },
      })
    }
  }
  for (const name of draft.tags ?? []) {
    const span = spans.tags?.[name.toLowerCase()]
    if (!span) continue
    const isNew = tags !== undefined && !tags.some((t) => sameName(t.name, name))
    // 지금 태그 + 이 입력에 아직 없는 자주 쓰는 태그
    const others = (tags ?? [])
      .filter((t) => !draft.tags?.some((d) => sameName(d, t.name)))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, TAG_OPTIONS_MAX)
    const options = [
      { label: `#${name}`, value: `#${name}`, current: true },
      ...others.map((t) => ({ label: `#${t.name}`, value: `#${t.name}` })),
    ]
    chips.push({
      key: `tag-${name}`,
      kind: 'tag',
      name,
      isNew,
      span,
      edit: { kind: 'options', title: `태그 ${name} 고치기`, options, removeLabel: '태그 빼기' },
    })
  }
  if (draft.priority && spans.priority) {
    const current = draft.priority
    chips.push({
      key: 'priority',
      kind: 'priority',
      text: `우선순위 ${PRIORITY_LABEL[current]}`,
      strong: current === 'HIGH',
      span: spans.priority,
      edit: {
        kind: 'options',
        title: '우선순위 고치기',
        options: (['HIGH', 'NORMAL', 'LOW'] as const).map((p) => ({
          label: PRIORITY_LABEL[p],
          value: `!${PRIORITY_LABEL[p]}`,
          current: p === current,
        })),
        removeLabel: '우선순위 빼기',
      },
    })
  }
  // 마감은 ~날짜에서 오거나, 시간 없이 쓴 맨 날짜에서 온다(toDraft)
  const dueSpan = spans.due ?? (draft.schedule ? undefined : spans.date)
  if (draft.due && dueSpan) {
    chips.push({
      key: 'due',
      kind: 'due',
      text: `마감 ${day(draft.due)}`,
      span: dueSpan,
      edit: { kind: 'options', title: '마감 고치기', options: dueOptions(today, draft.due), removeLabel: '마감 빼기' },
    })
  }
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
  // 드롭다운이 열린 칩(key). 키보드로 닫으면 그 칩 버튼으로 포커스를 돌린다
  const [editing, setEditing] = useState<string | null>(null)
  const chipButtons = useRef(new Map<string, HTMLButtonElement>())
  const closeEditor = useCallback(
    (by: 'keyboard' | 'outside') => {
      if (by === 'keyboard' && editing) chipButtons.current.get(editing)?.focus()
      setEditing(null)
    },
    [editing],
  )

  const today = todayIn(user?.timezone ?? 'Asia/Seoul')
  const weekStart = weekStartNumber(user?.weekStart)
  const parsed = useMemo(() => parseQuickInput(value, { today, weekStart }), [value, today, weekStart])
  const draft = useMemo(() => toDraft(parsed, today), [parsed, today])
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
  const chips = chipsOf(draft, parsed.spans, today, projects.data, tags.data)

  // 고르면 그 낱말만 바꾸고 입력창으로 돌아간다(칩이 바뀌거나 사라지기 때문)
  const pickChip = (span: Span, replacement: string) => {
    onChange(replaceSpan(value, span, replacement))
    setEditing(null)
    inputRef.current?.focus()
  }
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
                const color = c.kind === 'project' && c.project ? projectColor(c.project.color) : undefined
                const className = [
                  styles.chip,
                  styles[c.kind],
                  c.kind === 'tag' && c.isNew && styles.tagNew,
                  'strong' in c && c.strong && styles.strong,
                ]
                  .filter(Boolean)
                  .join(' ')
                const open = editing === c.key
                return (
                  <li key={c.key} className={styles.chipItem}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) chipButtons.current.set(c.key, el)
                        else chipButtons.current.delete(c.key)
                      }}
                      className={className}
                      style={color && { background: color.tint, color: color.ink }}
                      aria-label={c.kind === 'tag' && c.isNew ? `새 태그 ${c.name}` : undefined}
                      aria-haspopup={c.edit.kind === 'time' ? 'dialog' : 'menu'}
                      aria-expanded={open}
                      onClick={() => setEditing(open ? null : c.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' && !open) {
                          e.preventDefault()
                          setEditing(c.key)
                        }
                      }}
                    >
                      {c.kind === 'tag' ? (
                        <>
                          #{c.name}
                          {c.isNew && (
                            <span className={styles.newBadge} aria-hidden="true">
                              새
                            </span>
                          )}
                        </>
                      ) : (
                        c.text
                      )}
                    </button>
                    {open && (
                      <ChipEditor
                        edit={c.edit}
                        onPick={(replacement) => pickChip(c.span, replacement)}
                        onClose={closeEditor}
                      />
                    )}
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

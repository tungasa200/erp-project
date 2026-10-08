// SCR-COM-02 빠른 입력창. 입력하는 동안 해석 결과를 칩으로 미리 보여 준다(오해석 방지).
// @프로젝트는 그 프로젝트 색 칩, 없는 프로젝트는 "새 프로젝트 만들기" 칩(눌러서 확인 후 생성).
// #태그는 태그마다 칩 하나, 없는 태그는 저장할 때 만들어지므로 "새" 표시만 한다(P1-02 결정 B안, erp-design 칩 기준).
// 칩을 누르면 그 값만 고치는 드롭다운이 열린다(P1-09-12, ChipEditor).
// 비어 있는 입력창에 포커스가 가면 자주 하는 업무(④, P1-09-10·P2-04)를 칩으로 보여 주고, 고르면 제목·@프로젝트·#태그를 채운다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../components/useToast'
import { PROJECTS_QUERY_KEY, projectApi, TAGS_QUERY_KEY, tagApi, type Project, type Tag } from '../projects/api'
import { nextColor, projectColor } from '../projects/palette'
import { useShortcutsEnabled } from '../shortcuts/useShortcuts'
import { useFrequentTasks, type FrequentTask } from '../tasks/api'
import { ChipEditor, type ChipEdit } from './ChipEditor'
import { addDays, isoWeekday, shortDate, todayIn, weekStartNumber } from './dates'
import { GrammarHelp } from './GrammarHelp'
import {
  parseQuickInput,
  replaceSpan,
  toDraft,
  unreadTimeWord,
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
  // 시간처럼 생겼는데 읽지 못해 제목에 들어간 낱말(9:00~10:00 같은 입력이 말없이 제목이 되던 것)
  const unreadTime = unreadTimeWord(draft.title)
  // 제목 없이 Enter를 누른 횟수. 안내를 오류로 바꿔 보여 주고, 다시 고치기 시작하면 0으로 돌아간다
  const [emptyTries, setEmptyTries] = useState(0)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const shortcutsEnabled = useShortcutsEnabled()
  // 입력창이나 제안 칩에 포커스가 있는 동안(focused). 제안은 처음 포커스가 간 뒤부터 받는다(asked)
  const [focused, setFocused] = useState(false)
  const [asked, setAsked] = useState(false)
  const frequent = useFrequentTasks(asked)
  const typing = value.trim() !== ''
  const titleError = emptyTries > 0 && typing && draft.title === ''
  // 받는 중이거나 0개면 아무것도 보이지 않는다
  const suggestions = focused && !typing && !helpOpen ? (frequent.data ?? []) : []
  const suggestButtons = useRef<(HTMLButtonElement | null)[]>([])
  // @·#을 쓸 때(또는 제안에 프로젝트·태그가 있을 때)만 목록을 받는다. 자주 바뀌지 않으므로 30초 동안은 다시 받지 않는다.
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: async () => (await projectApi.list()).items,
    enabled: Boolean(draft.project) || suggestions.some((s) => s.projectId),
    staleTime: 30_000,
  })
  const tags = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: async () => (await tagApi.list()).items,
    enabled: Boolean(draft.tags?.length) || suggestions.some((s) => s.tagIds.length > 0),
    staleTime: 30_000,
  })
  const chips = chipsOf(draft, parsed.spans, today, projects.data, tags.data)

  // 제안을 고르면 한 줄 문법으로 채우고 입력창으로 돌아간다(시간을 덧붙여 Enter로 저장).
  // 이름에 공백이 있는 프로젝트·태그는 한 낱말로 쓸 수 없어 뺀다
  const suggestionText = (s: FrequentTask) => {
    const word = (name: string | undefined, mark: string) => (name && !/\s/.test(name) ? ` ${mark}${name}` : '')
    const project = projects.data?.find((p) => p.id === s.projectId)
    const tagWords = s.tagIds.map((tagId) => word(tags.data?.find((t) => t.id === tagId)?.name, '#')).join('')
    return `${s.title}${word(project?.name, '@')}${tagWords} `
  }
  const pickSuggestion = (s: FrequentTask) => {
    onChange(suggestionText(s))
    inputRef.current?.focus()
  }
  // 제안 칩 사이는 화살표로 오간다. 첫 칩에서 위·왼쪽, 또는 Esc면 입력창으로
  const moveInSuggestions = (e: React.KeyboardEvent, index: number) => {
    const next = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1 }[e.key]
    if (e.key === 'Escape' || next === -1) {
      e.preventDefault()
      inputRef.current?.focus()
    } else if (next !== undefined) {
      e.preventDefault()
      suggestButtons.current[Math.min(next, suggestions.length - 1)]?.focus()
    }
  }

  // 고르면 그 낱말만 바꾸고 입력창으로 돌아간다(칩이 바뀌거나 사라지기 때문)
  const pickChip = (span: Span, replacement: string) => {
    onChange(replaceSpan(value, span, replacement))
    setEditing(null)
    inputRef.current?.focus()
  }

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
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      suggestButtons.current[0]?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!onSubmit) return
      if (draft.title === '') {
        if (typing) setEmptyTries((n) => n + 1)
        return
      }
      // 저장에 실패하면(onSubmit이 거부) 입력을 그대로 남긴다. 오류 안내는 onSubmit 쪽이 맡는다.
      void Promise.resolve(onSubmit(draft)).then(
        () => onChange(''),
        () => {},
      )
    }
  }

  return (
    <div
      className={styles.wrap}
      onFocus={() => {
        setFocused(true)
        setAsked(true)
        // 다른 15분 칸으로 넘어갔거나 지난번에 못 받았으면 새로 받는다(그동안은 받아 둔 제안을 보여 준다)
        if ((frequent.isError || (frequent.data && frequent.isStale)) && !frequent.isFetching) void frequent.refetch()
      }}
      // 입력창과 제안 칩 사이를 오갈 때는 닫지 않는다
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
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
          onChange={(e) => {
            setEmptyTries(0)
            onChange(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          aria-describedby={typing ? `${id}-preview` : undefined}
          aria-invalid={titleError || undefined}
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

      {suggestions.length > 0 && (
        <div className={styles.preview}>
          <p id={`${id}-frequent`} className={styles.suggestTitle}>
            자주 하는 업무
          </p>
          <ul className={styles.chips} aria-labelledby={`${id}-frequent`}>
            {suggestions.map((s, i) => {
              const project = projects.data?.find((p) => p.id === s.projectId)
              return (
                <li key={s.latestTaskId}>
                  <button
                    type="button"
                    ref={(el) => {
                      suggestButtons.current[i] = el
                    }}
                    className={`${styles.chip} ${styles.suggestion}`}
                    title={s.title}
                    // 접근 이름은 한 문자열로. 글자 조각을 이어 붙이면 브라우저가 사이에 빈 칸을 넣어 "제목 , 영업"이 된다
                    aria-label={project ? `${s.title}, ${project.name}` : s.title}
                    // 누르는 동안 포커스를 입력창에 둔다. 버튼에 포커스를 주지 않는 브라우저(Safari)에서 칩이 먼저 사라지지 않게
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    onKeyDown={(e) => moveInSuggestions(e, i)}
                  >
                    {project && (
                      <span
                        className={styles.suggestionDot}
                        style={{ background: projectColor(project.color).base }}
                        aria-hidden="true"
                      />
                    )}
                    <span className={styles.suggestionTitle}>{s.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

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
          {unreadTime && (
            <p className={styles.hint}>
              시간으로 읽지 못했어요: <span className={styles.unread}>{unreadTime}</span> (예: 14:00-15:00 · 오후
              2시~3시)
            </p>
          )}
          {/* 오류로 바뀔 때(또 Enter를 눌렀을 때도) 새로 붙여 화면 낭독기가 다시 읽게 한다 */}
          <p
            key={titleError ? `error-${emptyTries}` : 'hint'}
            className={titleError ? styles.hintError : styles.hint}
            role={titleError ? 'alert' : undefined}
          >
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

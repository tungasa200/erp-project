// SCR-COM-03 명령 팔레트 (UX-01). 지금은 동작(업무 추가)·화면 이동·날짜 이동만 있다.
// 업무·일지 검색, 하루 마감·타이머 같은 동작은 해당 기능 단계에서 COMMANDS에 더한다.
import { Command } from 'cmdk'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { shortDate, todayIn, weekStartNumber } from '../quickInput/dates'
import { parseQuickInput } from '../quickInput/parse'
import { modKey, useShortcutsEnabled } from '../shortcuts/useShortcuts'
import styles from './CommandPalette.module.css'
import { objectParticle } from './particle'

interface PaletteCommand {
  id: string
  label: string
  group: '동작' | '이동'
  keywords?: string
  shortcut?: string
  run: () => void
}

const RECENT_KEY = 'worklog.palette.recent'
const RECENT_MAX = 5

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((r) => r !== id)].slice(0, RECENT_MAX)))
  } catch {
    // 저장하지 못하면 최근 항목만 비어 보인다.
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '')

interface Props {
  onClose: () => void
  /** 빠른 입력창으로 이동(N과 같은 동작). 글자를 주면 미리 채운다 */
  onQuickAdd: (text?: string) => void
}

export function CommandPalette({ onClose, onQuickAdd }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const shortcutsEnabled = useShortcutsEnabled()
  const [query, setQuery] = useState('')

  const commands = useMemo<PaletteCommand[]>(() => {
    const go = (to: string) => () => navigate(to)
    return [
      {
        id: 'add-task',
        label: '업무 추가',
        group: '동작',
        keywords: '할일 새 업무 빠른 입력 기록',
        shortcut: shortcutsEnabled ? 'N' : undefined,
        run: () => onQuickAdd(),
      },
      { id: 'go-home', label: '홈', group: '이동', keywords: '대시보드', run: go('/') },
      { id: 'go-calendar', label: '캘린더', group: '이동', keywords: '일정', run: go('/calendar') },
      { id: 'go-tasks', label: '업무 목록', group: '이동', keywords: '할일', run: go('/tasks') },
      { id: 'go-logs', label: '업무일지', group: '이동', keywords: '일지', run: go('/logs') },
      { id: 'go-stats', label: '통계', group: '이동', run: go('/stats') },
      { id: 'go-settings', label: '설정', group: '이동', keywords: '환경설정 프로필', run: go('/settings') },
    ]
  }, [navigate, onQuickAdd, shortcutsEnabled])

  const q = query.trim()
  const today = todayIn(user?.timezone ?? 'Asia/Seoul')

  const visible = useMemo(() => {
    if (q === '') {
      const recent = readRecent()
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is PaletteCommand => c !== undefined)
      return { recent, matched: commands }
    }
    const needle = normalize(q)
    return {
      recent: [],
      matched: commands.filter((c) => normalize(`${c.label} ${c.keywords ?? ''}`).includes(needle)),
    }
  }, [q, commands])

  // "10/12", "다음주 수요일"처럼 날짜만 적으면 그날 캘린더로 이동
  const parsed = q === '' ? null : parseQuickInput(q, { today, weekStart: weekStartNumber(user?.weekStart) })
  const jumpDate = parsed && parsed.date && parsed.title === '' && !parsed.time ? parsed.date : undefined

  const run = (command: PaletteCommand) => {
    saveRecent(command.id)
    onClose()
    command.run()
  }

  const groups = (['동작', '이동'] as const)
    .map((g) => ({ heading: g, items: visible.matched.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0)
  const nothing = visible.matched.length === 0 && !jumpDate

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        className={styles.dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
          // 포커스가 갈 곳은 검색 입력 하나뿐이다.
          if (e.key === 'Tab') e.preventDefault()
        }}
      >
        <Command shouldFilter={false} loop label="명령 팔레트" className={styles.command}>
          <div className={styles.search}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5" />
            </svg>
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="명령이나 화면 이름을 입력하세요"
              className={styles.input}
            />
            <kbd className={styles.kbd}>Esc</kbd>
          </div>
          <Command.List className={styles.list}>
            {nothing && (
              <Command.Group heading="동작" className={styles.group}>
                <Command.Item
                  value="quick-add-text"
                  className={styles.item}
                  onSelect={() => {
                    onClose()
                    onQuickAdd(q)
                  }}
                >
                  <span className={styles.icon} aria-hidden="true">
                    +
                  </span>
                  <span className={styles.label}>
                    ‘{q}’{objectParticle(q)} 업무로 추가
                  </span>
                </Command.Item>
              </Command.Group>
            )}
            {jumpDate && (
              <Command.Group heading="이동" className={styles.group}>
                <Command.Item
                  value="jump-date"
                  className={styles.item}
                  onSelect={() => {
                    onClose()
                    navigate(`/calendar/day/${jumpDate}`)
                  }}
                >
                  <span className={styles.icon} aria-hidden="true">
                    ▦
                  </span>
                  <span className={styles.label}>{shortDate(jumpDate)} 캘린더 보기</span>
                </Command.Item>
              </Command.Group>
            )}
            {visible.recent.length > 0 && (
              <Command.Group heading="최근 사용" className={styles.group}>
                {visible.recent.map((c) => (
                  <Item key={c.id} command={c} value={`recent-${c.id}`} onRun={run} />
                ))}
              </Command.Group>
            )}
            {groups.map((g) => (
              <Command.Group key={g.heading} heading={g.heading} className={styles.group}>
                {g.items.map((c) => (
                  <Item key={c.id} command={c} value={c.id} onRun={run} />
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className={styles.footer} aria-hidden="true">
            <span>↑↓ 이동</span>
            <span>Enter 실행</span>
            <span>Esc 닫기</span>
            <span className={styles.footerEnd}>{modKey('K')}</span>
          </div>
        </Command>
      </div>
    </div>
  )
}

function Item({
  command,
  value,
  onRun,
}: {
  command: PaletteCommand
  value: string
  onRun: (c: PaletteCommand) => void
}) {
  return (
    <Command.Item value={value} className={styles.item} onSelect={() => onRun(command)}>
      <span className={styles.icon} aria-hidden="true">
        {command.group === '동작' ? '+' : '→'}
      </span>
      <span className={styles.label}>{command.label}</span>
      {command.shortcut && <kbd className={styles.kbd}>{command.shortcut}</kbd>}
    </Command.Item>
  )
}

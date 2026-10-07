// 캘린더 업무 패널 (SCR-CAL-09, P1-08): 일정이 없는 업무를 그리드로 끌어 놓으면 1시간 일정이 생기고 업무와 연결된다.
// 마감 있는 업무는 마감순(초과 강조), 마감 없는 업무는 접어 둔다. 키보드는 카드의 "일정 잡기" 버튼으로 같은 일을 한다.
import { useState, type ReactNode } from 'react'
import { Skeleton } from '../components/Skeleton'
import type { Project } from '../projects/api'
import type { Task } from '../tasks/api'
import { TASK_DRAG_TYPE } from './TimeGrid'
import { WEEKDAY_LABELS, diffDays, weekdayIndex } from './time'
import styles from './calendar.module.css'
import panel from './taskPanel.module.css'

interface Props {
  tasks: Task[]
  projects: Project[]
  today: string
  /** 첫 로딩(isPending): 스켈레톤 */
  pending: boolean
  /** 다음 쪽 불러오는 중 */
  loadingMore: boolean
  /** false면(오프라인, P1-X-04) 카드를 끌 수 없고 일정 잡기도 꺼진다. 패널 빠른 입력은 CalendarPage가 끈다 */
  editable?: boolean
  /** 서버에 더 있으면 */
  hasMore: boolean
  onLoadMore: () => void
  /** 키보드 대안: 상세 모달로 시간을 골라 일정 만들기 */
  onPlace: (task: Task) => void
  /** 패널 안 빠른 입력(④) */
  quickInput?: ReactNode
}

function dueLabel(due: string, today: string) {
  const days = diffDays(today, due)
  if (days === 0) return '오늘 마감'
  if (days === -1) return '어제 마감'
  if (days < 0) return `${-days}일 지남`
  if (days === 1) return '내일 마감'
  return `${Number(due.slice(5, 7))}/${Number(due.slice(8))} ${WEEKDAY_LABELS[weekdayIndex(due)]}`
}

export function TaskPanel({
  tasks,
  projects,
  today,
  pending,
  loadingMore,
  editable = true,
  hasMore,
  onLoadMore,
  onPlace,
  quickInput,
}: Props) {
  const [showUndated, setShowUndated] = useState(false)
  const dated = tasks.filter((t) => t.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
  const undated = tasks.filter((t) => !t.dueDate)
  const projectOf = (t: Task) => projects.find((p) => p.id === t.projectId)

  const card = (t: Task) => {
    const project = projectOf(t)
    const key = project?.color.toLowerCase()
    const late = !!t.dueDate && t.dueDate < today
    return (
      <li
        key={t.id}
        className={panel.card}
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData(TASK_DRAG_TYPE, t.id)
          e.dataTransfer.setData('text/plain', t.title)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        style={key ? { background: `var(--project-${key}-tint)` } : undefined}
      >
        <span className={panel.title}>{t.title}</span>
        <span className={panel.meta}>
          {project && (
            <span className={panel.chip} style={{ color: `var(--project-${key}-ink)` }}>
              {project.name}
            </span>
          )}
          {t.dueDate && (
            <span className={panel.chip} data-late={late || undefined}>
              {dueLabel(t.dueDate, today)}
            </span>
          )}
          <button
            type="button"
            className={panel.place}
            disabled={!editable}
            onClick={() => onPlace(t)}
            aria-label={`${t.title} 일정 잡기`}
            data-focus-item
          >
            일정 잡기
          </button>
        </span>
      </li>
    )
  }

  return (
    <aside className={styles.taskPanel} aria-labelledby="task-panel-title" data-focus-list>
      <div className={styles.taskPanelHead}>
        <h2 id="task-panel-title">할 일 상자</h2>
        <kbd className={styles.kbd} aria-hidden="true">
          P
        </kbd>
      </div>
      <p className={styles.muted}>끌어다 놓으면 1시간 일정이 돼요</p>
      {quickInput}
      {!pending && tasks.length === 0 && <p className={styles.empty}>배치할 업무가 없어요</p>}
      {pending && <Skeleton shape="card" count={3} height={64} />}
      <ul className={panel.list}>{dated.map(card)}</ul>
      {undated.length > 0 &&
        (showUndated ? (
          <ul className={panel.list} aria-label="날짜 없는 업무">
            {undated.map(card)}
          </ul>
        ) : (
          <button type="button" className={panel.more} onClick={() => setShowUndated(true)}>
            날짜 없는 업무 {undated.length}개 더 보기
          </button>
        ))}
      {hasMore && (
        <button type="button" className={panel.more} onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? '불러오는 중…' : '더 불러오기'}
        </button>
      )}
    </aside>
  )
}

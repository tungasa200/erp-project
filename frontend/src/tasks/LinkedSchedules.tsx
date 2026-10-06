// SCR-TASK-02 ⑤ 연결 일정 목록 (P1-05-06, 결정 A): 다가오는 회차 최대 5개, 넘으면 캘린더에서 더 보기,
// 없으면 안내와 [캘린더에 배치](캘린더 업무 패널 '일정 잡기'와 같은 만들기 창으로 연다).
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import type { Occurrence } from '../calendar/api'
import type { CalendarLocationState } from '../calendar/CalendarPage'
import { addDays, formatMinutes, fromZoned, toZoned, todayIn } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { shortDate } from '../quickInput/dates'
import { useTaskOccurrences, type Task } from './api'
import own from './LinkedSchedules.module.css'
import styles from './tasks.module.css'

const LIMIT = 5
const WINDOW_DAYS = 90

export function LinkedSchedules({ task, archived }: { task: Task; archived: boolean }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  // 지금 이후(진행 중 포함) 90일. 열 때의 시각으로 고정해 다시 그려도 같은 요청을 쓴다
  const [from] = useState(() => new Date().toISOString())
  const to = fromZoned(addDays(today, WINDOW_DAYS), 0, timeZone)
  const query = useTaskOccurrences(task.id, from, to, { enabled: task.hasSchedule })

  const startOf = (o: Occurrence) => (o.allDay ? fromZoned(o.startDate!, 0, timeZone) : o.startAt!)
  const items = [...(query.data ?? [])].sort((a, b) => startOf(a).localeCompare(startOf(b)))
  const visible = items.slice(0, LIMIT)

  const placeOnCalendar = () =>
    navigate(`/calendar/day/${today}`, {
      state: { scheduleTask: { id: task.id, title: task.title } } satisfies CalendarLocationState,
    })

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span id={`linked-${task.id}`} className={styles.fieldLabel}>
          연결된 일정
        </span>
        {!archived && (
          <button type="button" className={styles.smallButton} onClick={placeOnCalendar}>
            캘린더에 배치
          </button>
        )}
      </div>
      {task.hasSchedule && query.isPending && <Skeleton count={2} />}
      {query.isError && (
        <p role="alert" className={styles.error}>
          일정을 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </p>
      )}
      {(!task.hasSchedule || (query.isSuccess && items.length === 0)) && (
        <p className={styles.muted}>
          {task.hasSchedule ? `앞으로 ${WINDOW_DAYS}일 안에 잡힌 일정이 없어요` : '아직 일정이 없어요'}
        </p>
      )}
      {visible.length > 0 && (
        <ul className={own.linkedList} aria-labelledby={`linked-${task.id}`}>
          {visible.map((o) => {
            const date = o.allDay ? o.startDate! : toZoned(o.startAt!, timeZone).date
            return (
              <li key={`${o.scheduleId}|${o.occurrenceStart}`}>
                <Link to={`/calendar/day/${date}`} className={own.linkedItem}>
                  <span className={own.linkedDate}>{shortDate(date)}</span>
                  <span className={own.linkedTime}>{timeText(o, timeZone)}</span>
                  {o.recurring && <span className={own.repeatBadge}>반복</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {items.length > LIMIT && (
        <Link to={`/calendar/list`} className={own.moreLink}>
          일정 {items.length - LIMIT}개 더 · 캘린더에서 보기
        </Link>
      )}
    </div>
  )
}

function timeText(o: Occurrence, timeZone: string) {
  if (o.allDay) return o.startDate === o.endDate ? '종일' : `종일 · ${shortDate(o.endDate!)}까지`
  const s = toZoned(o.startAt!, timeZone)
  const e = toZoned(o.endAt!, timeZone)
  const end = e.date === s.date ? formatMinutes(e.minutes) : `${shortDate(e.date)} ${formatMinutes(e.minutes)}`
  return `${formatMinutes(s.minutes)} – ${end}`
}

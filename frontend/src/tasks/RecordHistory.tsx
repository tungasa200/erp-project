// SCR-TASK-02 ⑥ 기록 이력 (P2): 이 업무에 연결된 확정 기록을 최근 날짜부터. 날짜 · 내용 · 결과 · (시간 기록 옵션) 시간.
// 행을 누르면 기록 추가·수정(SCR-REC-01). 확인 대기·하지 않음은 한 일이 아니라 뺀다(일지와 같은 기준).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import type { components } from '../api/generated/worklog'
import { useAuth } from '../auth/useAuth'
import { addDays, formatMinutes, toZoned, todayIn } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { durationText } from '../home/gaps'
import { shortDate } from '../quickInput/dates'
import type { WorkRecord } from '../records/api'
import { RecordDialog } from '../records/RecordDialog'
import { useTimeTracking } from '../settings/useWorklogSettings'
import own from './RecordHistory.module.css'
import styles from './tasks.module.css'

/** 목록 API는 from~to가 400일 이내다. 앞날짜로 적은 기록도 보이게 30일 뒤까지, 나머지는 지난 370일 */
const PAST_DAYS = 370
const AHEAD_DAYS = 30
const FIRST = 10

const OUTCOME_LABEL: Record<NonNullable<WorkRecord['outcome']>, string> = {
  DONE: '완료',
  REVIEW_REQUESTED: '검토 요청',
  IN_PROGRESS: '진행 중',
}

export function RecordHistory({ taskId }: { taskId: string }) {
  const id = useId()
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const timed = useTimeTracking()
  const today = todayIn(timeZone)
  const from = addDays(today, -PAST_DAYS)
  const to = addDays(today, AHEAD_DAYS)
  const query = useQuery({
    queryKey: ['records', 'task', taskId, from, to],
    queryFn: () =>
      api.request<components['schemas']['WorkRecordList']>(
        `/api/worklog/records?from=${from}&to=${to}&taskId=${taskId}&status=CONFIRMED`,
      ),
    select: (d) =>
      [...d.items].sort(
        // 같은 날이면 늦게 시작한(시각이 없으면 늦게 만든) 기록부터. 오프셋 표기가 달라도 같은 순간이라 숫자로 비교한다
        (a, b) =>
          b.workDate.localeCompare(a.workDate) ||
          Date.parse(b.startAt ?? b.createdAt) - Date.parse(a.startAt ?? a.createdAt),
      ),
  })
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const items = query.data ?? []
  const visible = all ? items : items.slice(0, FIRST)
  // 더 보기 버튼은 누르면 사라지므로 새로 보인 첫 기록으로 포커스를 옮긴다
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (all) listRef.current?.querySelectorAll<HTMLButtonElement>('button')[FIRST]?.focus()
  }, [all])

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span id={`${id}-label`} className={styles.fieldLabel}>
          기록 이력
        </span>
      </div>
      {query.isPending && <Skeleton count={2} />}
      {query.isError && (
        <p role="alert" className={styles.error}>
          기록을 불러오지 못했어요
          <button type="button" className={styles.smallButton} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </p>
      )}
      {query.isSuccess && items.length === 0 && <p className={styles.muted}>아직 이 업무로 남긴 기록이 없어요</p>}
      {visible.length > 0 && (
        <ul ref={listRef} className={own.list} aria-labelledby={`${id}-label`} data-focus-list>
          {visible.map((r) => {
            const outcome = outcomeText(r)
            const time = timed ? timeText(r, timeZone) : null
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={own.item}
                  data-focus-item
                  data-focus-id={`record-${r.id}`}
                  aria-haspopup="dialog"
                  onClick={() => setEditing(r.id)}
                >
                  <span className={own.date}>{shortDate(r.workDate)}</span>
                  <span className={own.body}>
                    <span className={own.content} title={r.content.length > 80 ? r.content : undefined}>
                      {r.content}
                    </span>
                    {(outcome || time) && (
                      <span className={own.meta}>{[outcome, time].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!all && items.length > FIRST && (
        <button type="button" className={own.more} onClick={() => setAll(true)}>
          이전 기록 {items.length - FIRST}개 더 보기
        </button>
      )}
      {editing && <RecordDialog recordId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** 완료 · 검토 요청 · 진행 중 40%에 결과 한 줄을 붙인다 */
function outcomeText(r: WorkRecord) {
  const chip = r.outcome
    ? r.outcome === 'IN_PROGRESS' && r.progress != null
      ? `${OUTCOME_LABEL.IN_PROGRESS} ${r.progress}%`
      : OUTCOME_LABEL[r.outcome]
    : null
  const result = r.result?.trim() || null
  return [chip, result].filter(Boolean).join(' — ') || null
}

/** 시작~종료(날을 넘기면 다음 날), 실행 중이면 "시작~ 진행 중", 시작이 없으면 소요시간 */
function timeText(r: WorkRecord, timeZone: string) {
  if (r.startAt) {
    const s = toZoned(r.startAt, timeZone)
    if (!r.endAt) return `${formatMinutes(s.minutes)}~ 진행 중`
    const e = toZoned(r.endAt, timeZone)
    return `${formatMinutes(s.minutes)}–${e.date !== s.date ? '다음 날 ' : ''}${formatMinutes(e.minutes)}`
  }
  return r.durationMin ? durationText(r.durationMin) : null
}

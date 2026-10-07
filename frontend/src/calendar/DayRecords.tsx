// SCR-CAL-02 ③ 일 보기 "이날의 기록": 시간 없는 기록을 포함한 그날 기록 전체(세 상태)와 기록 추가.
// 시간이 없는 기록은 그리드에 나타나지 않아 이 목록이 지난 기록을 고치는 기본 장소다. 누르면 SCR-REC-01.
// 시간은 시간 기록 옵션이 켜졌을 때만 적는다(옵션은 화면 표시만 바꾼다, TIME-09).
// 확인 대기 기록은 시간이 비어 있어(D-100) 옵션과 관계없이 계획 시간을 적는다(홈 확인 대기 목록과 같게). 확인 대기 목록의 plan, 없으면(7일 넘음) 그날 회차.
import { useId } from 'react'
import { Skeleton } from '../components/Skeleton'
import type { WorkRecord } from '../records/api'
import { planTime, usePendingRecords } from '../records/pending'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { RecordStatusTag } from './RecordStatusTag'
import type { Occurrence } from './api'
import { occurrenceOf, recordTimeText, useRecordsOnDate } from './recordStatus'
import styles from './records.module.css'

interface Props {
  date: string
  timeZone: string
  /** 보이는 기간의 회차(확인 대기 행의 계획 시간) */
  occurrences: Occurrence[]
  editable: boolean
  onOpen: (record: WorkRecord) => void
  onAdd: () => void
}

export function DayRecords({ date, timeZone, occurrences, editable, onOpen, onAdd }: Props) {
  const id = useId()
  const timed = useTimeTracking()
  const records = useRecordsOnDate(date)
  const items = records.data ?? []
  const pending = usePendingRecords(items.some((r) => r.status === 'PENDING'))
  const planText = (r: WorkRecord) => {
    if (r.status !== 'PENDING' || r.startAt) return null
    const plan = pending.data?.find((p) => p.id === r.id)?.plan ?? occurrenceOf(occurrences, r)
    return plan ? planTime(plan, timeZone) || null : null
  }

  return (
    <section className={styles.dayRecords} aria-labelledby={`${id}-title`}>
      <div className={styles.dayRecordsHead}>
        <h2 id={`${id}-title`} className={styles.dayRecordsTitle}>
          이날의 기록
        </h2>
        <button
          type="button"
          className={styles.addButton}
          aria-haspopup="dialog"
          disabled={!editable}
          title={editable ? undefined : '연결되면 기록을 추가할 수 있어요'}
          onClick={onAdd}
        >
          기록 추가
        </button>
      </div>
      {records.isPending ? (
        records.fetchStatus === 'paused' ? (
          <p className={styles.dayRecordsNote} role="status">
            연결되면 기록을 불러올게요
          </p>
        ) : (
          <Skeleton shape="lines" count={3} />
        )
      ) : records.isError ? (
        <p className={styles.dayRecordsNote} role="alert">
          기록을 불러오지 못했어요.{' '}
          <button type="button" className={styles.addButton} onClick={() => void records.refetch()}>
            다시 시도
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className={styles.dayRecordsNote}>이날 남긴 기록이 없어요</p>
      ) : (
        <ul className={styles.recordList}>
          {items.map((r) => {
            const plan = planText(r)
            const time = plan ? null : timed ? recordTimeText(r, timeZone) : null
            return (
              <li key={r.id} className={r.status === 'DISMISSED' ? styles.recordDismissed : undefined}>
                <button
                  type="button"
                  className={styles.recordItem}
                  aria-haspopup="dialog"
                  data-record-id={r.id}
                  onClick={() => onOpen(r)}
                >
                  <span className={styles.recordMeta}>
                    <RecordStatusTag record={r} />
                    {plan && <span>계획 {plan}</span>}
                    {time && <span>{time}</span>}
                  </span>
                  <span className={styles.recordContent}>{r.content}</span>
                  {r.result && <span className={styles.recordResult}>{r.result}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// SCR-CAL-02 ③ 일 보기 "이날의 기록": 시간 없는 기록을 포함한 그날 기록 전체(세 상태)와 기록 추가.
// 시간이 없는 기록은 그리드에 나타나지 않아 이 목록이 지난 기록을 고치는 기본 장소다. 누르면 SCR-REC-01.
// 시간은 시간 기록 옵션이 켜졌을 때만 적는다(옵션은 화면 표시만 바꾼다, TIME-09).
// 끝나기 전 회차의 확인 대기(타이머를 1분 미만으로 버리면 서버가 PENDING으로 되돌림)는 홈 ③처럼 없는 것으로 본다(D-31).
// 확인 대기 기록은 시간이 비어 있어(D-100) 옵션과 관계없이 계획 시간을 적는다(홈 확인 대기 목록과 같게). 확인 대기 목록의 plan, 없으면(7일 넘음) 그날 회차.
// 머리 아래 [하루 마감](SCR-LOG-03)은 오늘·지난 날에만 둔다. 창은 openDayClose로 앱 셸이 띄운다(그날로 연다).
// 머리에 건수. 결과 글 없는 '했어요' 기록은 한 줄 행(44px), 6건 이상이면 끝난 기록은 5번째 뒤부터 접는다. 확인 대기는 할 일이라 접지 않는다(UX-M-REC-56, WY-design 2026-10-13).
// 접으면 머리글 요약 한 줄("5건 · 대기 2 · 일지 초안")과 펼치기 버튼만 남긴다(X-07 D, ux2 조건). 접힘은 이 기기에 기억한다.
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Skeleton } from '../components/Skeleton'
import { useLogPeriods, type LogStatus } from '../logs/api'
import { openDayClose } from '../logs/openDayClose'
import type { WorkRecord } from '../records/api'
import { planTime, usePendingRecords } from '../records/pending'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { RecordStatusTag } from './RecordStatusTag'
import type { Occurrence } from './api'
import { useDayPanel } from './dayPanels'
import { occurrenceOf, planEnded, recordTimeText, useRecordsOnDate } from './recordStatus'
import { formatMinutes, todayIn, toZoned } from './time'
import styles from './records.module.css'

interface Props {
  date: string
  timeZone: string
  /** 보이는 기간의 회차(확인 대기 행의 계획 시간) */
  occurrences: Occurrence[]
  /** 지금 시각(ms). 끝나기 전 회차의 확인 대기를 가린다 */
  now: number
  editable: boolean
  onOpen: (record: WorkRecord) => void
  onAdd: () => void
}

export function DayRecords({ date, timeZone, occurrences, now, editable, onOpen, onAdd }: Props) {
  const id = useId()
  const [open, setOpen] = useDayPanel('records')
  // 접기·펼치기는 버튼이 바뀌어 그리므로 누른 뒤 새 버튼으로 포커스를 옮긴다(UX-CAL-174, 그러지 않으면 body로 떨어짐)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  const toggle = (next: boolean) => {
    toggled.current = true
    setOpen(next)
  }
  useLayoutEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    toggleRef.current?.focus()
  }, [open])
  const timed = useTimeTracking()
  const records = useRecordsOnDate(date)
  const all = records.data ?? []
  const pending = usePendingRecords(all.some((r) => r.status === 'PENDING'))
  const planOf = (r: WorkRecord) => pending.data?.find((p) => p.id === r.id)?.plan ?? occurrenceOf(occurrences, r)
  // 시각순(UX-M-REC-102): startAt, 없으면 회차 시작, 둘 다 없으면 맨 끝. 같으면 받은 순서(정렬은 안정)
  const items = all
    .filter((r) => r.status !== 'PENDING' || planEnded(planOf(r), now, timeZone))
    .sort((a, b) => sortTime(a) - sortTime(b))
  // 펼침은 그 날에만. 날을 옮기면 다시 접힌다
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const expanded = expandedDate === date
  const headRef = useRef<HTMLDivElement>(null)
  const foldable = (r: WorkRecord, i: number) => i >= FOLD_AFTER && r.status !== 'PENDING'
  const hiddenCount = items.length > FOLD_AFTER ? items.filter(foldable).length : 0
  const shownItems = expanded || !hiddenCount ? items : items.filter((r, i) => !foldable(r, i))
  const waiting = items.filter((r) => r.status === 'PENDING').length
  // 펼친 머리도 접힌 요약과 같은 말(건수 · 대기 · 마감함, UX-M-REC-56 재평가)
  const periods = useLogPeriods('DAILY', date, date)
  const logText = logTextOf(periods.data?.items.find((p) => p.periodStart === date)?.status)
  const planText = (r: WorkRecord) => {
    if (r.status !== 'PENDING' || r.startAt) return null
    const plan = planOf(r)
    return plan ? planTime(plan, timeZone) || null : null
  }

  if (!open)
    return (
      <section className={styles.dayRecordsStrip} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className={styles.dayRecordsTitle}>
          이날의 기록
        </h2>
        {records.isError ? (
          <span className={styles.dayRecordsSummary}>기록을 불러오지 못했어요</span>
        ) : (
          <RecordsSummary
            date={date}
            count={records.isSuccess ? items.length : null}
            pending={items.filter((r) => r.status === 'PENDING').length}
          />
        )}
        <button
          type="button"
          className={styles.panelToggle}
          aria-expanded="false"
          ref={toggleRef}
          aria-label="이날의 기록 펼치기"
          onClick={() => toggle(true)}
        >
          <span aria-hidden="true">‹</span>
        </button>
      </section>
    )

  return (
    <section className={styles.dayRecords} aria-labelledby={`${id}-title`}>
      <div className={styles.dayRecordsHead} ref={headRef}>
        <h2 id={`${id}-title`} className={styles.dayRecordsTitle}>
          이날의 기록
          {records.isSuccess && items.length > 0 && (
            <span className={styles.dayRecordsCount}>
              {' '}
              · {items.length}건{waiting ? ` · 대기 ${waiting}` : ''}
              {logText ? ` · ${logText}` : ''}
            </span>
          )}
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
        <button
          type="button"
          className={styles.panelToggle}
          aria-expanded="true"
          ref={toggleRef}
          aria-label="이날의 기록 접기"
          onClick={() => toggle(false)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {date <= todayIn(timeZone, now) && (
        <button
          type="button"
          className={styles.dayCloseLink}
          aria-haspopup="dialog"
          onClick={() => openDayClose({ date })}
        >
          하루 마감
        </button>
      )}
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
        <>
          <ul className={styles.recordList} id={`${id}-list`}>
            {shownItems.map((r) => {
              const plan = planText(r)
              const time = plan ? null : timed ? recordTimeText(r, timeZone) : null
              const lineTime = startText(r, timed, timeZone)
              // 결과 글 없이 '했어요'뿐이면 한 줄. 상태는 ✓ 모양과 함께 낭독용 글로 알린다
              if (r.status === 'CONFIRMED' && !r.result)
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`${styles.recordItem} ${styles.recordLine}`}
                      aria-haspopup="dialog"
                      data-record-id={r.id}
                      onClick={() => onOpen(r)}
                    >
                      <span className={styles.recordLineCheck} aria-hidden="true">
                        ✓
                      </span>
                      <span className="visually-hidden">했어요, </span>
                      <span className={styles.recordLineText}>{r.content}</span>
                      {/* 낭독 이름에서 제목과 시각이 붙지 않게 띄운다(flex라 화면에는 영향 없음) */}
                      {lineTime && ' '}
                      {lineTime && <span className={styles.recordLineTime}>{lineTime}</span>}
                    </button>
                  </li>
                )
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
          {hiddenCount > 0 && (
            <button
              type="button"
              className={styles.foldButton}
              aria-expanded={expanded}
              aria-controls={`${id}-list`}
              onClick={() => {
                setExpandedDate(expanded ? null : date)
                // 접은 뒤 빈 자리에 머물지 않게 목록 머리로. 포커스는 이 버튼에 남는다
                if (expanded) headRef.current?.scrollIntoView?.({ block: 'nearest' })
              }}
            >
              {expanded ? '접기' : `나머지 ${hiddenCount}건 펼치기`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

const FOLD_AFTER = 5

const sortTime = (r: WorkRecord) => {
  const at = r.startAt ?? r.occurrenceStart
  return at ? Date.parse(at) : Infinity
}

/** 한 줄 행의 시작 시각(UX-M-REC-102): "09:30", 진행 중이면 "09:30~". 시간 기록을 끄면 회차 시작만(TIME-09) */
function startText(r: WorkRecord, timed: boolean, timeZone: string) {
  const at = (timed && r.startAt) || r.occurrenceStart
  if (!at) return null
  const text = formatMinutes(toZoned(at, timeZone).minutes)
  return timed && r.startAt && !r.endAt ? `${text}~` : text
}

// 업무일지 숨김(D-214): 확정이면 '마감함'만, 초안은 보이지 않는다
const LOG_TEXT: Partial<Record<LogStatus, string>> = { CONFIRMED: '마감함' }
const logTextOf = (status: LogStatus | undefined) => (status ? LOG_TEXT[status] : undefined)

/** 접힌 패널의 요약 */
function RecordsSummary({ date, count, pending }: { date: string; count: number | null; pending: number }) {
  const periods = useLogPeriods('DAILY', date, date)
  const status = periods.data?.items.find((p) => p.periodStart === date)?.status
  const parts = [
    count === null ? null : `${count}건`,
    pending ? `대기 ${pending}` : null,
    logTextOf(status) ?? null,
  ].filter(Boolean)
  return <span className={styles.dayRecordsSummary}>{parts.join(' · ')}</span>
}

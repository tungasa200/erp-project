// SCR-HOME-02 확인 대기 목록 (REC-03, P2-03). 홈의 요약 카드·띠에서 연다(하루 마감 1단계도 재사용 예정).
// ① 날짜별 목록(일정명·계획 시간·연결 업무) ② 항목별 했어요/안 했어요 ③ 모두 했어요.
// "수정"은 SCR-REC-01을 만들 때 붙인다(pm 결정 2026-10-07). 확인은 반드시 사람이 한다: 모두 했어요는 화면에 보인 id만 보낸다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toastForError } from '../api/errorToast'
import { ApiError } from '../api/problem'
import { formatMinutes, toZoned } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { useOnline } from '../components/useOnline'
import { useToast } from '../components/useToast'
import { addDays, shortDate } from '../quickInput/dates'
import { useTask } from '../tasks/api'
import { PENDING_QUERY_KEY, pendingApi, usePendingRecords, type PendingRecord } from './pending'
import styles from './PendingPanel.module.css'

interface Props {
  today: string
  timeZone: string
  /** emptied: 다 처리해서 저절로 닫힘 */
  onClose: (emptied: boolean) => void
}

type Done = { id: string; version: number }
const NONE: PendingRecord[] = []
const CONFIRM_LIMIT = 200

export function PendingPanel({ today, timeZone, onClose }: Props) {
  const pending = usePendingRecords()
  const queryClient = useQueryClient()
  const { showToast, showUndo } = useToast()
  const online = useOnline()
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  const items = pending.data ?? NONE

  const headingRef = useRef<HTMLHeadingElement>(null)
  // 열면 제목으로 포커스(입력 칸이 없는 목록이라 무엇을 열었는지 먼저 읽히게)
  useEffect(() => headingRef.current?.focus(), [])

  // 처리한 항목이 빠지면 이웃 항목의 했어요로, 없으면 제목으로. 0건이 되면 닫는다(SCR-HOME-02 상태·예외)
  const focusAfter = useRef<{ gone: string[]; next: string | null } | null>(null)
  const loaded = pending.isSuccess
  useEffect(() => {
    if (!loaded) return
    if (items.length === 0) return onClose(true)
    const want = focusAfter.current
    if (!want || items.some((x) => want.gone.includes(x.id))) return
    focusAfter.current = null
    const next = want.next && document.querySelector<HTMLElement>(`[data-pending-confirm="${want.next}"]`)
    ;(next || headingRef.current)?.focus()
  }, [loaded, items, onClose])

  const removeFromList = (ids: string[]) =>
    queryClient.setQueryData<{ items: PendingRecord[] }>(PENDING_QUERY_KEY, (old) =>
      old ? { items: old.items.filter((x) => !ids.includes(x.id)) } : old,
    )
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['records'] })

  const fail = (error: unknown) => {
    if (error instanceof ApiError && (error.code === 'VERSION_CONFLICT' || error.status === 404)) {
      refresh()
      showToast('다른 곳에서 먼저 바뀌어서 새로 불러왔어요')
      return
    }
    const { message, traceId } = toastForError(error)
    showToast(message, { traceId })
  }

  const undoAll = (done: Done[]) => async () => {
    try {
      await Promise.all(done.map((d) => pendingApi.setStatus(d.id, 'PENDING', d.version)))
    } catch (error) {
      fail(error)
    }
    refresh()
  }

  const nextAfter = (ids: string[]) => {
    const index = items.findIndex((x) => ids.includes(x.id))
    const rest = items.filter((x) => !ids.includes(x.id))
    return (rest[index] ?? rest[index - 1])?.id ?? null
  }

  const decide = async (record: PendingRecord, status: 'CONFIRMED' | 'DISMISSED') => {
    if (busy.has(record.id)) return
    setBusy((s) => new Set(s).add(record.id))
    try {
      const saved = await pendingApi.setStatus(record.id, status, record.version)
      focusAfter.current = { gone: [record.id], next: nextAfter([record.id]) }
      removeFromList([record.id])
      showUndo({
        group: `pending-${status}`,
        message: (n) => (status === 'CONFIRMED' ? `${n}건을 했어요로 기록했어요` : `${n}건을 안 했어요로 표시했어요`),
        undo: undoAll([{ id: saved.id, version: saved.version }]),
      })
      refresh()
    } catch (error) {
      fail(error)
    } finally {
      setBusy((s) => {
        const copy = new Set(s)
        copy.delete(record.id)
        return copy
      })
    }
  }

  const [confirmingAll, setConfirmingAll] = useState(false)
  const confirmAll = async () => {
    if (confirmingAll) return
    // 화면에 보인 것만 보낸다. 목록을 받은 뒤 새로 생긴 확인 대기는 다음 조회에서 보인다(D-100)
    const ids = items.map((x) => x.id)
    setConfirmingAll(true)
    try {
      // 계약은 한 번에 200개까지. 7일치가 그보다 많으면 나눠 보낸다
      const saved: { id: string; version: number }[] = []
      for (let i = 0; i < ids.length; i += CONFIRM_LIMIT) {
        saved.push(...(await pendingApi.confirm(ids.slice(i, i + CONFIRM_LIMIT))).items)
      }
      focusAfter.current = { gone: ids, next: null }
      removeFromList(ids)
      showUndo({
        group: 'pending-all',
        message: () => `${saved.length}건을 모두 했어요로 기록했어요`,
        undo: undoAll(saved.map((x) => ({ id: x.id, version: x.version }))),
      })
      refresh()
    } catch (error) {
      // 나눠 보낸 앞쪽이 이미 확정됐을 수 있어 목록을 다시 받는다
      refresh()
      fail(error)
    } finally {
      setConfirmingAll(false)
    }
  }

  const groups = groupByDate(items)
  const title = loaded ? `확인 대기 ${items.length}건` : '확인 대기'

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-title"
        className={styles.sheet}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose(false)
          }
        }}
      >
        <div className={styles.head}>
          <h2 id="pending-title" ref={headingRef} tabIndex={-1} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="닫기" onClick={() => onClose(false)}>
            ×
          </button>
        </div>
        <p className={styles.lead}>끝난 계획이에요. 실제로 했는지 알려 주면 기록으로 남겨요.</p>

        {pending.isPending && <Skeleton count={3} />}
        {pending.isError && (
          <p role="alert" className={styles.error}>
            확인 대기를 불러오지 못했어요
            <button
              type="button"
              className={styles.retry}
              onClick={() => {
                headingRef.current?.focus()
                void pending.refetch()
              }}
            >
              다시 시도
            </button>
          </p>
        )}

        <div className={styles.body}>
          {groups.map(([date, list]) => (
            <section key={date} aria-labelledby={`pending-day-${date}`} className={styles.group}>
              <h3 id={`pending-day-${date}`} className={styles.day}>
                {dayLabel(date, today)}
              </h3>
              <ul className={styles.rows}>
                {list.map((record) => (
                  <PendingRow
                    key={record.id}
                    record={record}
                    timeZone={timeZone}
                    disabled={!online || busy.has(record.id) || confirmingAll}
                    onDecide={(status) => void decide(record, status)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {items.length > 0 && (
          <div className={styles.foot}>
            {!online && <p className={styles.muted}>연결되면 처리할 수 있어요</p>}
            <button
              type="button"
              className={styles.primary}
              disabled={!online || confirmingAll}
              onClick={() => void confirmAll()}
            >
              {items.length}건 모두 했어요
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingRow(props: {
  record: PendingRecord
  timeZone: string
  disabled: boolean
  onDecide: (status: 'CONFIRMED' | 'DISMISSED') => void
}) {
  const { record, timeZone, disabled, onDecide } = props
  const task = useTask(record.taskId ?? undefined)
  const name = record.plan.title
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        <span className={styles.meta}>
          <span>{planTime(record.plan, timeZone)}</span>
          {task.data && (
            <span className={styles.task} title={task.data.title}>
              <span className={styles.srOnly}>연결 업무 </span>
              {task.data.title}
            </span>
          )}
        </span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.yes}
          data-pending-confirm={record.id}
          aria-label={`${name} 했어요`}
          disabled={disabled}
          onClick={() => onDecide('CONFIRMED')}
        >
          했어요
        </button>
        <button
          type="button"
          className={styles.no}
          aria-label={`${name} 안 했어요`}
          disabled={disabled}
          onClick={() => onDecide('DISMISSED')}
        >
          안 했어요
        </button>
      </div>
    </li>
  )
}

/** 서버 정렬(workDate → 회차 시작)을 그대로 두고 날짜로만 묶는다 */
function groupByDate(items: PendingRecord[]): [string, PendingRecord[]][] {
  const map = new Map<string, PendingRecord[]>()
  for (const x of items) map.set(x.workDate, [...(map.get(x.workDate) ?? []), x])
  return [...map]
}

function dayLabel(date: string, today: string) {
  if (date === today) return `오늘 · ${shortDate(date)}`
  if (date === addDays(today, -1)) return `어제 · ${shortDate(date)}`
  return shortDate(date)
}

/** 계획 시간(기록의 시간 칸은 비어 있다, D-100). 날을 넘으면 끝 날짜를 붙인다 */
function planTime(plan: PendingRecord['plan'], timeZone: string): string {
  if (plan.allDay) {
    return !plan.endDate || plan.endDate === plan.startDate ? '종일' : `종일 · ${shortDate(plan.endDate)}까지`
  }
  if (!plan.startAt || !plan.endAt) return ''
  const s = toZoned(plan.startAt, timeZone)
  const e = toZoned(plan.endAt, timeZone)
  const end = e.date === s.date ? formatMinutes(e.minutes) : `${shortDate(e.date)} ${formatMinutes(e.minutes)}`
  return `${formatMinutes(s.minutes)} – ${end}`
}

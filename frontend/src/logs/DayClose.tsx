// SCR-LOG-03 하루 마감 (P3-05, LOG-14·16, D-107, 디자인 규칙 v1.1 X-05). 홈 띠·일지 카드·팔레트·캘린더 기록 패널이 openDayClose로 연다.
// 1 확인 대기(0건이면 건너뜀): 이름을 보이고 주 버튼은 [모두 했어요](5초 되돌리기), 하나씩은 확인 대기 패널
// → 2 계획으로 넘길 일(기본 모두 선택) → 3 이슈 한 줄·실적 미리보기 → 확정(Ctrl/⌘+Enter).
// 완료 창: 요약 한 줄, [닫기], 상시 [마감 취소](D-212 Q3). 팔레트 '빠른 마감'(quick)은 단계를 건너뛰고 바로 확정해 완료 창을 보인다.
// 업무일지 숨김(사용자 결정 2026-10-12, docs/ux/업무일지숨김_문안_v1.md 3장): 창 안에서는 지금처럼 일지를 확정하지만 '일지'라는 말을 쓰지 않고,
// [일지 보기]·주간·월간 제안·[내보내기]·프로필 안내·3단계 일지 미리보기(요약 한 줄만 남김)는 보이지 않는다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '../api/client'
import { toastForError } from '../api/errorToast'
import { Modal, ModalCloseButton } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { toZoned } from '../format/datetime'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { shortDate } from '../quickInput/dates'
import { PendingPanel } from '../records/PendingPanel'
import { pendingApi, planTime, usePendingRecords, type PendingRecord } from '../records/pending'
import { modKey } from '../shortcuts/useShortcuts'
import { logApi, refreshLogs, storeLog, useLog, type DailyCloseResult, type WorkLog } from './api'
import { periodText } from './format'
import styles from './logs.module.css'

type Step = 'pending' | 'carry' | 'issue'

/** 계약 상한: 계획 50줄, 이슈 칸 2000자(마감 이슈는 기존 이슈 끝에 한 줄로 붙음) */
const PLAN_MAX = 50
const ISSUES_MAX = 2000
/** 1단계에 이름으로 보이는 대기 수. 넘으면 "외 n건" */
const PENDING_SHOWN = 5

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

interface Props {
  date: string
  today: string
  timeZone: string
  /** 팔레트 '빠른 마감': 대기는 그대로, 넘길 일은 기본 선택, 이슈는 비운 채 바로 확정 */
  quick?: boolean
  onClose: () => void
}

function fieldCode(error: unknown, field: string) {
  return error instanceof ApiError ? error.problem?.errors?.find((e) => e.field === field)?.code : undefined
}

/** 확인 대기가 들어갈 날(계획 시작일). 다른 날이면 1단계에 날짜 배지, 3단계에 "그날 일지에 들어가요" */
function pendingDate(record: PendingRecord, timeZone: string) {
  const { plan } = record
  if (plan.allDay) return plan.startDate ?? null
  return plan.startAt ? toZoned(plan.startAt, timeZone).date : null
}

const CONFIRM_ALL_GROUP = 'day-close-confirm-all'

export function DayClose({ date, today, timeZone, quick = false, onClose }: Props) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast, showUndo, dismissUndo } = useToast()
  const plan = useQuery({ queryKey: ['logs', 'close', date], queryFn: () => logApi.closePlan(date) })
  const log = useLog('DAILY', date)
  const [step, setStep] = useState<Step | null>(null)
  const [hadPending, setHadPending] = useState<boolean | null>(null)
  const pending = usePendingRecords(hadPending === true && !quick)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [issue, setIssue] = useState('')
  const [busy, setBusy] = useState(false)
  /** 빠른 마감이 실패했을 때(토스트로 알림) 창에 [다시 시도] */
  const [failed, setFailed] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [result, setResult] = useState<DailyCloseResult | null>(null)
  /** 완료 창의 [확정 해제] 확인 줄 */
  const [askUnconfirm, setAskUnconfirm] = useState(false)
  /** 해제한 뒤: "초안으로 돌렸어요" + [다시 마감]·[일지 보기] */
  const [reopened, setReopened] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const unconfirmRef = useRef<HTMLButtonElement>(null)

  const data = plan.data
  // 처음 받은 값으로 단계 수·기본 선택을 정한다(1단계에서 다 처리해도 "1/3"이 "1/2"로 바뀌지 않게). 렌더 중 한 번 맞춤
  // 기본 선택은 계획 남은 칸까지만(계획 50줄, 이미 계획에 있는 업무는 칸을 쓰지 않음)
  if (data && log.data && hadPending == null) {
    setHadPending(data.pendingCount > 0)
    const inPlan = new Set(log.data.content.plans.map((p) => p.taskId))
    let room = PLAN_MAX - log.data.content.plans.length
    const pick = data.carryOverCandidates.filter((c) => c.selected && (inPlan.has(c.taskId) || room-- > 0))
    setSelected(new Set(pick.map((c) => c.taskId)))
  }

  const steps: Step[] = hadPending ? ['pending', 'carry', 'issue'] : ['carry', 'issue']
  const current: Step = step ?? (hadPending ? 'pending' : 'carry')
  const index = steps.indexOf(current)

  // 처음 다 받으면 그 단계의 주 버튼(없으면 첫 입력 칸·제목)으로, 단계가 바뀌면 그 단계 제목으로(누른 [다음]·[이전]이 사라지므로)
  // 대기 이름을 다 받아야 [모두 했어요]가 켜진다
  const ready = selected != null && !log.isPending && !(hadPending && !quick && pending.isPending)
  const moved = useRef(false)
  const issueRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!ready || quick) return
    const heading = headingRef.current
    // 이슈 단계는 쓰는 칸으로 바로(UX-LOG-144: 제목 다음 Tab이 [×]라 이슈를 쓰려다 창을 닫던 것)
    const issueInput = current === 'issue' ? issueRef.current : null
    if (moved.current) return (issueInput && !issueInput.disabled ? issueInput : heading)?.focus()
    const input = heading?.closest('[role=dialog]')?.querySelector<HTMLElement>('input:not(:disabled)')
    ;(primaryRef.current ?? input ?? heading)?.focus()
  }, [ready, current, result, reopened, quick])
  const go = (next: Step) => {
    moved.current = true
    setStep(next)
  }
  // 확인 대기 패널을 닫고 돌아오면(다 처리하지 않았을 때) 그 패널을 연 [하나씩 확인]으로. Modal이 첫 버튼에 맞춘 뒤에 돈다
  const backFromPending = useRef(false)
  const pendingButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (pendingOpen || !backFromPending.current) return
    backFromPending.current = false
    pendingButtonRef.current?.focus()
  }, [pendingOpen])
  // 확정 해제 확인 줄을 열면 [계속 두기]로, 닫으면 그 줄을 연 [확정 해제]로
  const unconfirmTouched = useRef(false)
  useEffect(() => {
    if (askUnconfirm) {
      unconfirmTouched.current = true
      keepRef.current?.focus()
    } else if (unconfirmTouched.current) unconfirmRef.current?.focus()
  }, [askUnconfirm])

  async function submit() {
    if (!data || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const done = await logApi.close(date, {
        carryOverTaskIds: data.carryOverCandidates.filter((c) => selected?.has(c.taskId)).map((c) => c.taskId),
        issue: issue.trim() || null,
        version: log.data?.id ? log.data.version : 0,
      })
      storeLog(queryClient, done.log)
      void refreshLogs(queryClient)
      // 확정한 뒤 [모두 했어요]를 되돌리면 확정 일지 실적과 확인 대기가 어긋난다. 해제는 완료 창 [확정 해제]로(UX-LOG-152)
      dismissUndo(CONFIRM_ALL_GROUP)
      moved.current = true
      setResult(done)
    } catch (error) {
      setFailed(true)
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        showToast('다른 곳에서 먼저 마감했어요. 새로 불러왔어요')
        void log.refetch()
      } else if (error instanceof ApiError && error.code === 'LOG_CONFIRMED') {
        void plan.refetch()
      } else if (fieldCode(error, 'carryOverTaskIds') === 'TOO_MANY') {
        // 다른 곳에서 계획을 늘렸을 때. 새 일지로 남은 칸을 다시 보여 준다
        showToast(`계획은 ${PLAN_MAX}줄까지예요. 넘길 업무를 줄여 주세요`)
        void log.refetch()
        go('carry')
      } else if (fieldCode(error, 'issue') === 'TOO_LONG') {
        showToast(`이슈 및 특이사항은 모두 ${ISSUES_MAX}자까지예요. 이슈를 줄여 주세요`)
        void log.refetch()
      } else {
        showToast('마감하지 못했어요. 잠시 후 다시 시도해 주세요', { traceId: (error as ApiError)?.traceId })
      }
    } finally {
      setBusy(false)
    }
  }

  // 빠른 마감: 다 받으면 한 번 바로 확정한다
  const quickStarted = useRef(false)
  useEffect(() => {
    if (!quick || !ready || quickStarted.current || !data || data.log.status === 'CONFIRMED') return
    quickStarted.current = true
    void submit()
  })

  const dayName = date === today ? '오늘' : `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`
  const titleId = `${id}-t`

  if (pendingOpen) {
    return (
      <PendingPanel
        today={today}
        timeZone={timeZone}
        onClose={(emptied) => {
          setPendingOpen(false)
          void plan.refetch()
          void log.refetch()
          if (emptied) go('carry')
          else backFromPending.current = true
        }}
      />
    )
  }

  // [모두 했어요]: 대기를 계획 시각대로 확정하고 2단계로. 5초 되돌리기(X-04 규칙 2)
  async function confirmAll(records: PendingRecord[]) {
    if (busy || records.length === 0) return
    setBusy(true)
    try {
      const saved = await pendingApi.confirm(records.map((r) => r.id))
      const done = saved.items.map((r) => ({ id: r.id, version: r.version }))
      const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ['records'] })
        void plan.refetch()
        void log.refetch()
      }
      showUndo({
        group: CONFIRM_ALL_GROUP,
        message: () => `확인 대기 ${done.length}건을 ‘했어요’로 기록했어요`,
        undo: async () => {
          try {
            await Promise.all(done.map((d) => pendingApi.setStatus(d.id, 'PENDING', d.version)))
          } catch (error) {
            const { message, traceId } = toastForError(error)
            showToast(message, { traceId })
          }
          refresh()
        },
      })
      refresh()
      go('carry')
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: ['records'] })
      const { message, traceId } = toastForError(error)
      showToast(message, { traceId })
    } finally {
      setBusy(false)
    }
  }

  async function unconfirm(confirmed: WorkLog) {
    if (busy || !confirmed.id) return
    setBusy(true)
    try {
      const draft = await logApi.unconfirm(confirmed.id, confirmed.version)
      storeLog(queryClient, draft)
      void refreshLogs(queryClient)
      setAskUnconfirm(false)
      unconfirmTouched.current = false
      setReopened(true)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        showToast('다른 곳에서 먼저 마감했어요. 새로 불러왔어요')
        void plan.refetch()
        void log.refetch()
      } else {
        const { message, traceId } = toastForError(error)
        showToast(message, { traceId })
      }
    } finally {
      setBusy(false)
    }
  }

  // [다시 마감]: 처음 단계부터 새로 받는다
  const restart = () => {
    setResult(null)
    setReopened(false)
    setHadPending(null)
    setSelected(null)
    setStep(null)
    setIssue('')
    moved.current = false
    void plan.refetch()
    void log.refetch()
  }

  const head = (title: string, done = false) => (
    <div className={cal.dialogHead}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.dialogHeading}>
        {done && (
          <span className={styles.doneMark} aria-hidden="true">
            ✓{' '}
          </span>
        )}
        {title}
      </h2>
      <ModalCloseButton onClose={onClose} />
    </div>
  )

  // 완료 창·이미 마감한 날의 [마감 취소]: 창 안에서 한 번 묻는다(D-212 Q3)
  const unconfirmBlock = (confirmed: WorkLog) =>
    askUnconfirm ? (
      <div className={styles.undoConfirm} role="group" aria-labelledby={`${id}-uq`}>
        <p id={`${id}-uq`} className={styles.undoText}>
          <strong>마감을 취소할까요?</strong> 넘긴 계획은 그대로예요.
        </p>
        <div className={styles.undoActions}>
          <button ref={keepRef} type="button" className={cal.secondary} onClick={() => setAskUnconfirm(false)}>
            계속 두기
          </button>
          <button
            type="button"
            className={styles.neutralFill}
            disabled={busy}
            onClick={() => void unconfirm(confirmed)}
          >
            마감 취소
          </button>
        </div>
      </div>
    ) : (
      <p className={styles.undoRow}>
        <span className={styles.muted}>잘못 마감했나요?</span>
        <button ref={unconfirmRef} type="button" className={styles.inlineButton} onClick={() => setAskUnconfirm(true)}>
          마감 취소
        </button>
      </p>
    )

  let body
  let onKeyDown: ((e: KeyboardEvent) => void) | undefined
  if (reopened) {
    body = (
      <>
        {head('마감을 취소했어요')}
        <p className={styles.dialogBody}>넘긴 계획은 그대로예요. 다시 마감할 수 있어요.</p>
        <div className={cal.actions}>
          <button ref={primaryRef} type="button" className={cal.primary} onClick={restart}>
            다시 마감
          </button>
        </div>
      </>
    )
  } else if (result) {
    const c = result.log.content
    const planName = data?.planScope === 'NEXT_WEEK' ? '다음 주 계획' : '다음 근무일 계획'
    body = (
      <>
        {head(`${dayName} 하루를 마감했어요`, true)}
        <p className={styles.muted}>
          확정 기록 {c.achievements.length}건 · {planName} {c.plans.length}건
        </p>
        <div className={cal.actions}>
          <button type="button" className={cal.primary} onClick={onClose}>
            닫기
          </button>
        </div>
        {unconfirmBlock(result.log)}
      </>
    )
  } else if (plan.isPending || log.isPending || !selected || (quick && data?.log.status !== 'CONFIRMED')) {
    body = (
      <>
        {head(quick ? '빠른 마감' : '하루 마감')}
        {plan.isError || log.isError ? (
          <div className={styles.failed}>
            <p>마감 정보를 불러오지 못했어요.</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                void plan.refetch()
                void log.refetch()
              }}
            >
              다시 시도
            </button>
          </div>
        ) : quick && failed && !busy ? (
          <div className={styles.failed}>
            <p>바로 확정하지 못했어요.</p>
            <button type="button" className={styles.secondary} onClick={() => void submit()}>
              다시 시도
            </button>
          </div>
        ) : (
          <Skeleton count={4} />
        )}
      </>
    )
  } else if (data!.log.status === 'CONFIRMED') {
    body = (
      <>
        {head('하루 마감')}
        <p className={styles.dialogBody}>{dayName}은 이미 마감했어요.</p>
        <div className={cal.actions}>
          <button type="button" className={cal.primary} onClick={onClose}>
            닫기
          </button>
        </div>
        {log.data && unconfirmBlock(log.data)}
      </>
    )
  } else {
    const d = data!
    const stepText = `${index + 1}/${steps.length}`
    const content = log.data!.content
    // 이미 계획에 있는 업무는 또 넣지 않는다(개정대기 SCR-LOG-03)
    const picked = d.carryOverCandidates.filter(
      (c) => selected.has(c.taskId) && !content.plans.some((p) => p.taskId === c.taskId),
    )
    const planName = d.planScope === 'NEXT_WEEK' ? '다음 주 계획' : '다음 근무일 계획'
    const room = Math.max(0, PLAN_MAX - content.plans.length)
    const over = picked.length - room
    const full = picked.length >= room
    const newCount = d.carryOverCandidates.filter((c) => !content.plans.some((p) => p.taskId === c.taskId)).length
    // 마감 이슈는 기존 이슈 끝에 줄을 바꿔 붙는다
    const issueRoom = Math.max(0, ISSUES_MAX - (content.issues ? content.issues.length + 1 : 0))
    const capId = `${id}-cap`
    const back = index > 0 && (
      <button type="button" className={cal.secondary} onClick={() => go(steps[index - 1])}>
        이전
      </button>
    )
    const records = [...(pending.data ?? [])].sort((a, b) =>
      (a.plan.startAt ?? a.plan.startDate ?? '').localeCompare(b.plan.startAt ?? b.plan.startDate ?? ''),
    )
    const waiting = d.pendingCount > 0
    // 각 단계에서 Enter는 그 단계의 주 버튼이다(버튼·링크·입력 칸 위에서는 그 요소의 동작). 확정만 Ctrl/⌘+Enter
    onKeyDown = (e) => {
      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
      const target = e.target as HTMLElement
      if (current === 'issue') {
        if (!(e.ctrlKey || e.metaKey)) return
        e.preventDefault()
        if (!busy) void submit()
        return
      }
      // 체크박스 위 Enter는 고르기가 아니라 단계 주 버튼으로(UX-LOG-144). 고르기는 Space
      const checkbox = target instanceof HTMLInputElement && target.type === 'checkbox'
      if (!checkbox && target.closest('button, a, input, textarea, select')) return
      e.preventDefault()
      if (current === 'pending') {
        if (waiting && records.length > 0) void confirmAll(records)
        else if (!waiting) go('carry')
      } else if (over <= 0) go('issue')
    }
    body = (
      <>
        {head(`하루 마감 ${stepText}`)}
        {current === 'pending' && (
          <>
            <p className={styles.dialogBody}>
              {waiting
                ? `확인 대기 기록이 ${d.pendingCount}건 있어요. 확정한 기록만 ${dayName} 실적으로 남아요.`
                : '확인 대기 기록을 모두 처리했어요.'}
            </p>
            {waiting &&
              (pending.isPending ? (
                <Skeleton count={2} />
              ) : (
                <>
                  <ul className={styles.pendingList} aria-label="확인 대기 기록">
                    {records.slice(0, PENDING_SHOWN).map((r) => {
                      const day = pendingDate(r, timeZone)
                      return (
                        <li key={r.id} className={styles.pendingItem}>
                          <span className={styles.pendingTime}>{planTime(r.plan, timeZone)}</span>
                          <span className={styles.pendingTitle}>{r.content || r.plan.title}</span>
                          {day && day !== date && <span className={styles.dateBadge}>{shortDate(day, today)}</span>}
                        </li>
                      )
                    })}
                  </ul>
                  <p className={styles.muted}>
                    {records.length > PENDING_SHOWN && `외 ${records.length - PENDING_SHOWN}건 · `}
                    계획한 시각대로 기록돼요. 다르게 했다면 하나씩 확인하세요.
                  </p>
                </>
              ))}
            <div className={`${cal.actions} ${styles.pendingActions}`}>
              {waiting && (
                <button type="button" className={styles.skipLink} onClick={() => go('carry')}>
                  그대로 다음
                </button>
              )}
              {waiting && (
                <button
                  ref={pendingButtonRef}
                  type="button"
                  className={cal.secondary}
                  aria-haspopup="dialog"
                  onClick={() => setPendingOpen(true)}
                >
                  하나씩 확인
                </button>
              )}
              {waiting ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className={cal.primary}
                  disabled={busy || pending.isPending || records.length === 0}
                  onClick={() => void confirmAll(records)}
                >
                  모두 했어요
                </button>
              ) : (
                <button ref={primaryRef} type="button" className={cal.primary} onClick={() => go('carry')}>
                  다음
                </button>
              )}
            </div>
          </>
        )}
        {current === 'carry' && (
          <>
            <h3 className={styles.stepTitle}>
              {planName} <span className={styles.muted}>({periodText('DAILY', d.nextWorkday, d.nextWorkday)}부터)</span>
            </h3>
            <p className={styles.muted}>넘긴 일은 {planName}에 들어가요. 업무의 마감일은 바뀌지 않아요.</p>
            {newCount > room && (
              <p id={capId} className={over > 0 ? styles.capOver : styles.capNote} aria-live="polite">
                {room === 0
                  ? `${planName}이 ${PLAN_MAX}줄로 가득 찼어요. 더 넘길 수 없어요.`
                  : over > 0
                    ? `계획은 ${PLAN_MAX}줄까지예요. ${room}개까지 고를 수 있어요. ${over}개를 빼 주세요.`
                    : `계획은 ${PLAN_MAX}줄까지라 ${room}개까지 고를 수 있어요. (${picked.length}/${room})`}
              </p>
            )}
            {d.carryOverCandidates.length === 0 ? (
              <p className={styles.dialogBody}>넘길 업무가 없어요.</p>
            ) : (
              <fieldset className={styles.carry} aria-describedby={newCount > room ? capId : undefined}>
                <legend className="visually-hidden">계획으로 넘길 업무</legend>
                {d.carryOverCandidates.map((c) => (
                  <label key={c.taskId} className={cal.check}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.taskId)}
                      // 남은 칸을 다 쓰면 아직 안 고른 업무는 고를 수 없다(이미 계획에 있는 업무는 칸을 쓰지 않음)
                      disabled={full && !selected.has(c.taskId) && !content.plans.some((p) => p.taskId === c.taskId)}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(c.taskId)
                        else next.delete(c.taskId)
                        setSelected(next)
                      }}
                    />
                    <span className={styles.carryTitle}>{c.title}</span>
                    <span className={styles.muted}>
                      {c.status === 'IN_PROGRESS' ? `진행 ${c.progress}%` : '할 일'}
                      {c.dueDate ? ` · 마감 ${md(c.dueDate)}` : ''}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className={cal.actions}>
              {back}
              <button type="button" className={cal.primary} disabled={over > 0} onClick={() => go('issue')}>
                다음
              </button>
            </div>
          </>
        )}
        {current === 'issue' && (
          <>
            <label className={cal.field}>
              이슈 및 특이사항 (선택)
              <input
                ref={issueRef}
                className={cal.input}
                value={issue}
                maxLength={Math.min(500, issueRoom)}
                disabled={issueRoom === 0}
                enterKeyHint="done"
                aria-describedby={issueRoom < 500 ? `${id}-issue` : undefined}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="있으면 한 줄로 적어 주세요(비워도 돼요)"
              />
            </label>
            {issueRoom < 500 && (
              <p id={`${id}-issue`} className={styles.capNote}>
                {issueRoom === 0
                  ? `이슈는 ${ISSUES_MAX}자까지예요. 더 남길 수 없어요.`
                  : `이슈는 ${ISSUES_MAX}자까지라 ${issueRoom}자 더 남길 수 있어요.`}
              </p>
            )}
            <p className={styles.muted}>
              확정 기록 {content.achievements.length}건 · {planName} {content.plans.length + picked.length}건
            </p>
            <div className={cal.actions}>
              {/* 버튼 줄 밖에 두면 고정된 줄에 가려 잘린다(UX-M-LOG-40). 기록 추가 창과 같은 자리 */}
              <span id={`${id}-key`} className={`${styles.keyHint} keyboard-only`}>
                {modKey('Enter')}로 마감
              </span>
              {back}
              <button
                type="button"
                className={cal.primary}
                disabled={busy}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                aria-describedby={`${id}-key`}
                onClick={() => void submit()}
              >
                {date === today ? '오늘 마감' : '마감'}
              </button>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    // 확정 해제 확인 줄이 열려 있으면 Esc는 [계속 두기]와 같다(겹친 모달을 쓰지 않음)
    // 이슈 칸에 쓴 글은 Esc·바깥 누르기·[×]로 말없이 사라지지 않게 한 번 묻는다(X-04 규칙 1, 재평가 보조 점검 #6)
    <Modal
      labelledBy={titleId}
      onClose={askUnconfirm ? () => setAskUnconfirm(false) : onClose}
      dirty={issue.trim() !== '' && !askUnconfirm && !result}
    >
      {/* 단계 키보드(Enter·Ctrl+Enter)를 창 안 어디서든 받는다. display: contents라 창 배치는 그대로 */}
      <div className={styles.dayClose} onKeyDown={onKeyDown}>
        {body}
      </div>
    </Modal>
  )
}

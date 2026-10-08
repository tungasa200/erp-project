// SCR-LOG-03 하루 마감 (P3-05, LOG-14·16, D-107). 홈 오늘 일지 카드·명령 팔레트에서 연다.
// 1 확인 대기(0건이면 건너뜀, 처리는 기존 확인 대기 패널) → 2 계획으로 넘길 일(기본 모두 선택) → 3 이슈 한 줄·미리보기 → 확정.
// 끝나면 내보내기 바로가기(SCR-LOG-05)와 주간·월간 확정 제안(LOG-16). 이미 확정한 날은 "확정 해제 후 다시 마감할 수 있어요".
// 확정 직전에 프로필 빈 칸을 묻는다(SCR-ONB-01). 묻는 동안은 이 창 대신 그 창을 보이고, 저장·나중에 뒤 바로 마감한다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { Modal } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { PendingPanel } from '../records/PendingPanel'
import { logApi, logHref, refreshLogs, storeLog, useLog, type DailyCloseResult } from './api'
import { ExportDialog } from './ExportDialog'
import { periodText } from './format'
import { shouldAskProfile } from './profileAsk'
import { ProfilePrompt } from './ProfilePrompt'
import styles from './logs.module.css'

type Step = 'pending' | 'carry' | 'issue'

/** 계약 상한: 계획 50줄, 이슈 칸 2000자(마감 이슈는 기존 이슈 끝에 한 줄로 붙음) */
const PLAN_MAX = 50
const ISSUES_MAX = 2000

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

interface Props {
  date: string
  today: string
  timeZone: string
  onClose: () => void
}

function fieldCode(error: unknown, field: string) {
  return error instanceof ApiError ? error.problem?.errors?.find((e) => e.field === field)?.code : undefined
}

export function DayClose({ date, today, timeZone, onClose }: Props) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const plan = useQuery({ queryKey: ['logs', 'close', date], queryFn: () => logApi.closePlan(date) })
  const log = useLog('DAILY', date)
  const [step, setStep] = useState<Step | null>(null)
  const [hadPending, setHadPending] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [issue, setIssue] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [askProfile, setAskProfile] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { user } = useAuth()
  const [result, setResult] = useState<DailyCloseResult | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

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

  // 처음 다 받으면 첫 입력 칸(없으면 제목)으로, 단계가 바뀌면 그 단계 제목으로(누른 [다음]·[이전]이 사라지므로)
  const ready = selected != null && !log.isPending
  const moved = useRef(false)
  useEffect(() => {
    if (!ready) return
    const heading = headingRef.current
    if (moved.current) return heading?.focus()
    const input = heading?.closest('[role=dialog]')?.querySelector<HTMLElement>('input:not(:disabled)')
    ;(input ?? heading)?.focus()
  }, [ready, current, result])
  const go = (next: Step) => {
    moved.current = true
    setStep(next)
  }
  // 확인 대기 패널을 닫고 돌아오면(다 처리하지 않았을 때) 그 패널을 연 1단계 버튼으로. Modal이 첫 버튼에 맞춘 뒤에 돈다
  const backFromPending = useRef(false)
  const pendingButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (pendingOpen || !backFromPending.current) return
    backFromPending.current = false
    pendingButtonRef.current?.focus()
  }, [pendingOpen])

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
          if (emptied) go('carry')
          else backFromPending.current = true
        }}
      />
    )
  }

  // 내보내기는 이 창 대신 열고, 닫으면 마감도 끝낸다
  if (exporting && result) return <ExportDialog log={result.log} timeZone={timeZone} onClose={onClose} />

  if (askProfile && user) {
    return (
      <ProfilePrompt
        user={user}
        logKey={`DAILY-${date}`}
        type="DAILY"
        start={date}
        end={date}
        onDone={() => {
          setAskProfile(false)
          void submit(true)
        }}
      />
    )
  }

  async function submit(asked = false) {
    if (!data || busy) return
    if (!asked && shouldAskProfile(user, `DAILY-${date}`)) return setAskProfile(true)
    setBusy(true)
    try {
      const done = await logApi.close(date, {
        carryOverTaskIds: data.carryOverCandidates.filter((c) => selected?.has(c.taskId)).map((c) => c.taskId),
        issue: issue.trim() || null,
        version: log.data?.id ? log.data.version : 0,
      })
      storeLog(queryClient, done.log)
      void refreshLogs(queryClient)
      moved.current = true
      setResult(done)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        showToast('다른 곳에서 일지를 먼저 고쳤어요. 새로 불러왔으니 다시 마감해 주세요')
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

  const head = (title: string) => (
    <div className={cal.dialogHead}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.dialogHeading}>
        {title}
      </h2>
      <button type="button" className={cal.close} aria-label="닫기" onClick={onClose}>
        ×
      </button>
    </div>
  )

  let body
  if (result) {
    body = (
      <>
        {head(`${dayName} 일지를 확정했어요`)}
        {result.suggestions.length > 0 && (
          <ul className={styles.suggestions}>
            {result.suggestions.map((s) => (
              <li key={`${s.type}-${s.periodStart}`} className={styles.suggestion}>
                <span>
                  <strong>
                    {periodText(s.type, s.periodStart, s.periodEnd)} {s.type === 'WEEKLY' ? '주간' : '월간'} 일지
                  </strong>
                  도 확정할 수 있어요.
                </span>
                {s.unconfirmedDates.length > 0 && (
                  <span className={styles.muted}>확정 안 된 날: {s.unconfirmedDates.map(md).join(', ')}</span>
                )}
                <Link to={logHref(s.type, s.periodStart)} className={styles.textLink} onClick={onClose}>
                  {s.type === 'WEEKLY' ? '주간' : '월간'} 일지 열기
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className={cal.actions}>
          <button type="button" className={cal.secondary} onClick={onClose}>
            닫기
          </button>
          <button type="button" className={cal.secondary} aria-haspopup="dialog" onClick={() => setExporting(true)}>
            내보내기
          </button>
          <Link to={logHref('DAILY', date)} className={styles.primaryLink} onClick={onClose}>
            일지 보기
          </Link>
        </div>
      </>
    )
  } else if (plan.isPending || log.isPending || !selected) {
    body = (
      <>
        {head('하루 마감')}
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
        ) : (
          <Skeleton count={4} />
        )}
      </>
    )
  } else if (data!.log.status === 'CONFIRMED') {
    body = (
      <>
        {head('하루 마감')}
        <p className={styles.dialogBody}>{dayName} 일지는 이미 확정했어요. 확정 해제 후 다시 마감할 수 있어요.</p>
        <div className={cal.actions}>
          <button type="button" className={cal.secondary} onClick={onClose}>
            닫기
          </button>
          <Link to={logHref('DAILY', date)} className={styles.primaryLink} onClick={onClose}>
            일지 보기
          </Link>
        </div>
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
    body = (
      <>
        {head(`하루 마감 ${stepText}`)}
        {current === 'pending' && (
          <>
            <p className={styles.dialogBody}>
              {d.pendingCount > 0
                ? `확인 대기 기록이 ${d.pendingCount}건 있어요. 확정한 기록만 일지에 들어가요.`
                : '확인 대기 기록을 모두 처리했어요.'}
            </p>
            <div className={cal.actions}>
              {d.pendingCount > 0 && (
                <button
                  ref={pendingButtonRef}
                  type="button"
                  className={cal.secondary}
                  onClick={() => setPendingOpen(true)}
                >
                  확인 대기 처리
                </button>
              )}
              <button type="button" className={cal.primary} onClick={() => go('carry')}>
                {d.pendingCount > 0 ? '그대로 다음' : '다음'}
              </button>
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
                  ? `${planName}이 ${PLAN_MAX}줄로 가득 찼어요. 일지에서 계획을 지운 뒤 넘길 수 있어요.`
                  : over > 0
                    ? `계획은 ${PLAN_MAX}줄까지예요. ${room}개까지 고를 수 있어요. ${over}개를 빼 주세요.`
                    : `계획은 ${PLAN_MAX}줄까지라 ${room}개까지 고를 수 있어요. (${picked.length}/${room})`}
              </p>
            )}
            {d.carryOverCandidates.length === 0 ? (
              <p className={styles.dialogBody}>넘길 업무가 없어요.</p>
            ) : (
              <fieldset className={styles.carry} aria-describedby={newCount > room ? capId : undefined}>
                <legend className={styles.srOnly}>계획으로 넘길 업무</legend>
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
                className={cal.input}
                value={issue}
                maxLength={Math.min(500, issueRoom)}
                disabled={issueRoom === 0}
                aria-describedby={issueRoom < 500 ? `${id}-issue` : undefined}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="한 줄로 남겨 두세요"
              />
            </label>
            {issueRoom < 500 && (
              <p id={`${id}-issue`} className={styles.capNote}>
                {issueRoom === 0
                  ? `일지의 이슈 칸이 ${ISSUES_MAX}자로 가득 찼어요. 일지에서 줄인 뒤 남길 수 있어요.`
                  : `일지의 이슈 칸이 ${ISSUES_MAX}자까지라 ${issueRoom}자까지 남길 수 있어요.`}
              </p>
            )}
            <section className={styles.mini} aria-label="일지 미리보기">
              <p className={styles.miniHead}>{periodText('DAILY', date, date)} 업무일지</p>
              {content.achievements.length === 0 ? (
                <p className={styles.muted}>실적이 없어요. 확정한 기록이나 완료한 업무가 들어가요.</p>
              ) : (
                <ol className={styles.miniList}>
                  {content.achievements.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      {a.text}
                      {a.result ? ` — ${a.result}` : ''}
                    </li>
                  ))}
                </ol>
              )}
              {content.achievements.length > 5 && (
                <p className={styles.muted}>외 {content.achievements.length - 5}건</p>
              )}
              <p className={styles.muted}>
                실적 {content.achievements.length}건 · {planName} {content.plans.length + picked.length}건
              </p>
            </section>
            <div className={cal.actions}>
              {back}
              <button type="button" className={cal.primary} disabled={busy} onClick={() => void submit()}>
                마감하고 확정
              </button>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      {body}
    </Modal>
  )
}

// SCR-LOG-03 하루 마감 (P3-05, LOG-14·16, D-107). 홈 오늘 일지 카드·명령 팔레트에서 연다.
// 1 확인 대기(0건이면 건너뜀, 처리는 기존 확인 대기 패널) → 2 계획으로 넘길 일(기본 모두 선택) → 3 이슈 한 줄·미리보기 → 확정.
// 끝나면 주간·월간 확정 제안(LOG-16). 이미 확정한 날은 "확정 해제 후 다시 마감할 수 있어요".
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { Modal } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { PendingPanel } from '../records/PendingPanel'
import { logApi, logHref, refreshLogs, storeLog, useLog, type DailyCloseResult } from './api'
import { periodText } from './format'
import styles from './logs.module.css'

type Step = 'pending' | 'carry' | 'issue'

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

interface Props {
  date: string
  today: string
  timeZone: string
  onClose: () => void
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
  const [result, setResult] = useState<DailyCloseResult | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const data = plan.data
  // 처음 받은 값으로 단계 수·기본 선택을 정한다(1단계에서 다 처리해도 "1/3"이 "1/2"로 바뀌지 않게). 렌더 중 한 번 맞춤
  if (data && hadPending == null) {
    setHadPending(data.pendingCount > 0)
    setSelected(new Set(data.carryOverCandidates.filter((c) => c.selected).map((c) => c.taskId)))
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
        }}
      />
    )
  }

  const submit = async () => {
    if (!data || busy) return
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
                <button type="button" className={cal.secondary} onClick={() => setPendingOpen(true)}>
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
            <p className={styles.muted}>넘긴 일은 다음 근무일 계획에 들어가요. 업무의 마감일은 바뀌지 않아요.</p>
            {d.carryOverCandidates.length === 0 ? (
              <p className={styles.dialogBody}>넘길 업무가 없어요.</p>
            ) : (
              <fieldset className={styles.carry}>
                <legend className={styles.srOnly}>계획으로 넘길 업무</legend>
                {d.carryOverCandidates.map((c) => (
                  <label key={c.taskId} className={cal.check}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.taskId)}
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
              <button type="button" className={cal.primary} onClick={() => go('issue')}>
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
                maxLength={500}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="한 줄로 남겨 두세요"
              />
            </label>
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

// SCR-LOG-02 일지 상세·편집 (P3-06, LOG-01~06·15, D-107). /logs/daily/:date · /logs/weekly/:date · /logs/monthly/:yyyy-mm
// ① 상단 바: 이전·다음 기간, 상태 배지, 실적 자동/고정 알약(초안만, 종이 밖), 다시 채우기(고정 초안만), 확정·확정 해제, 변경 이력
// ② 문서(LogPaper) ④ 데스크톱 오른쪽: 이 기간 원본 기록 — "실적에 넣기"(끌기 대신 버튼, 키보드로도 같은 일)
// 내보내기(SCR-LOG-05, P3-10)는 고친 내용을 먼저 저장하고 연다. 고칠 수 있는 일지에 처음 들어오면 프로필 빈 칸을 묻는다(SCR-ONB-01).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { addMonths } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { ApiError } from '../api/client'
import { useProjects } from '../projects/api'
import { addDays, todayIn } from '../quickInput/dates'
import type { WorkRecord } from '../records/api'
import { ConfirmDialog, RevisionsDialog } from './LogDialogs'
import { ExportDialog } from './ExportDialog'
import { LogPaper, type PaperEditor } from './LogPaper'
import { logApi, logHref, refreshLogs, storeLog, useLog, type LogAchievement, type LogType, type WorkLog } from './api'
import { parseLogPath, periodText, STATUS_LABEL } from './format'
import { shouldAskProfile } from './profileAsk'
import { ProfilePrompt } from './ProfilePrompt'
import { useLogEditor } from './useLogEditor'
import styles from './logs.module.css'

const TYPE_NAME: Record<LogType, string> = { DAILY: '일간', WEEKLY: '주간', MONTHLY: '월간' }

function shift(type: LogType, start: string, by: number) {
  if (type === 'DAILY') return addDays(start, by)
  if (type === 'WEEKLY') return addDays(start, 7 * by)
  return addMonths(start, by)
}

export function LogPage() {
  const params = useParams()
  const parsed = parseLogPath(params.type, params.date)
  if (!parsed) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>일지를 찾을 수 없어요</h1>
        <p className={styles.muted}>주소의 날짜를 확인해 주세요.</p>
        <Link to="/logs" className={styles.textLink}>
          일지 목록으로
        </Link>
      </div>
    )
  }
  return <LogView key={`${parsed.type}-${parsed.start}`} type={parsed.type} start={parsed.start} />
}

function LogView({ type, start }: { type: LogType; start: string }) {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const query = useLog(type, start)
  const log = query.data
  const projects = useProjects()
  const [announce, setAnnounce] = useState('')
  const [dialog, setDialog] = useState<'refill' | 'unconfirm' | 'revisions' | 'export' | null>(null)
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const editor = useLogEditor(log, {
    onPinned: () => setAnnounce('실적을 고정했어요. 원본이 바뀌어도 그대로예요'),
    onConfirmed: () => showToast('확정한 일지는 고칠 수 없어요. 확정 해제 후 고칠 수 있어요'),
  })

  const editable = !!log && log.status !== 'CONFIRMED' && start <= today
  // 일지를 처음 받았을 때 한 번만 정한다(이 화면 안에서 다시 묻지 않음). 렌더 중 한 번 맞춤
  const [askProfile, setAskProfile] = useState<boolean | null>(null)
  if (log && askProfile == null) setAskProfile(editable && shouldAskProfile(user, `${type}-${start}`))
  const view = log && {
    ...log.content,
    achievements: editor.edits?.achievements ?? log.content.achievements,
    plans: editor.edits?.plans ?? log.content.plans,
    issues: editor.edits?.issues ?? log.content.issues,
  }
  // 보낼 수 있는 실적 수정(빈 줄 없음)이 있으면 저장 전이라도 고정으로 보인다. 줄만 추가한 상태는 아직 자동
  const localPin = !!editor.edits?.achievements && editor.edits.achievements.every((a) => a.text.trim())
  const pinned = !!log && (!log.content.achievementsAuto || localPin)

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'LOG_CONFIRMED') showToast('이미 확정된 일지예요')
    else if (error instanceof ApiError && error.code === 'LOG_NOT_CONFIRMED') showToast('이미 초안이에요')
    else if (error instanceof ApiError && error.code === 'VERSION_CONFLICT')
      showToast('다른 곳에서 먼저 고쳤어요. 새로 불러왔어요')
    else showToast('저장하지 못했어요. 잠시 후 다시 시도해 주세요', { traceId: (error as ApiError)?.traceId })
    void refreshLogs(queryClient)
  }

  const run = async (action: (current: WorkLog) => Promise<WorkLog>, done: string) => {
    if (!log || busy) return
    setBusy(true)
    try {
      const saved = (await editor.flush()) ?? log
      const ready = await editor.ensureSaved(saved)
      const next = await action(ready)
      // 확정·다시 채우기·해제 뒤에는 남은 빈 줄 같은 로컬 수정을 버리고 서버 값을 쓴다
      editor.reset()
      storeLog(queryClient, next)
      void queryClient.invalidateQueries({ queryKey: ['logs', 'revisions', next.id] })
      showToast(done)
      setDialog(null)
      // 누른 버튼이 사라지므로(확정 ↔ 확정 해제) 화면 제목으로
      headingRef.current?.focus()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const paperEditor: PaperEditor | undefined =
    editable && view
      ? {
          candidates: log.planCandidates,
          onAchievements: (achievements) => editor.change({ achievements }),
          onPlans: (plans) => editor.change({ plans }),
          onIssues: (issues) => editor.change({ issues }),
        }
      : undefined

  const prev = shift(type, start, -1)
  const next = shift(type, start, 1)

  return (
    <div className={styles.page}>
      <nav className={styles.crumbs} aria-label="일지 이동">
        <Link to="/logs" className={styles.textLink}>
          업무일지
        </Link>
        <span aria-hidden="true">›</span>
        <span>{TYPE_NAME[type]}</span>
      </nav>
      <div className={styles.bar}>
        <div className={styles.periodNav}>
          <Link to={logHref(type, prev)} className={styles.navButton} aria-label="이전 기간">
            ‹
          </Link>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            {periodText(type, start, log?.periodEnd ?? start)}
          </h1>
          <Link to={logHref(type, next)} className={styles.navButton} aria-label="다음 기간">
            ›
          </Link>
        </div>
        {log && (
          <div className={styles.barTools}>
            <span className={`${styles.badge} ${styles[`badge${log.status}`]}`}>{STATUS_LABEL[log.status]}</span>
            {log.status === 'DRAFT' && (
              <span className={styles.pill} tabIndex={0} aria-describedby="log-pill-tip">
                {pinned ? '실적 고정' : '실적 자동'}
                <span id="log-pill-tip" role="tooltip" className={styles.tip}>
                  {pinned
                    ? '직접 고친 실적이라 원본이 바뀌어도 그대로예요'
                    : '기록과 완료한 업무에서 실적을 채우고 있어요. 원본이 바뀌면 함께 바뀌어요'}
                </span>
              </span>
            )}
            <SaveText state={editor.state} />
            <span className={styles.spacer} />
            {log.status === 'DRAFT' && pinned && (
              <button type="button" className={styles.secondary} onClick={() => setDialog('refill')}>
                원본에서 다시 채우기
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              aria-haspopup="dialog"
              onClick={() => {
                // 파일은 서버에 저장된 내용으로 만들므로 남은 수정을 먼저 보낸다(실패는 편집기가 알림)
                void editor.flush().catch(() => {})
                setDialog('export')
              }}
            >
              내보내기
            </button>
            {log.id && (
              <button type="button" className={styles.secondary} onClick={() => setDialog('revisions')}>
                변경 이력
              </button>
            )}
            {log.status === 'CONFIRMED' ? (
              <button type="button" className={styles.secondary} onClick={() => setDialog('unconfirm')}>
                확정 해제
              </button>
            ) : (
              editable && (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void run((l) => logApi.confirm(l.id!, l.version), '일지를 확정했어요')}
                >
                  확정
                </button>
              )
            )}
          </div>
        )}
      </div>

      <p className={styles.srOnly} role="status">
        {announce}
      </p>

      {editor.state === 'conflict' && (
        <div className={styles.conflict} role="alert">
          <span>다른 곳에서 이 일지를 먼저 고쳤어요. 새로 불러오면 여기서 고친 내용은 사라져요.</span>
          <span className={styles.conflictTools}>
            <button type="button" className={styles.secondary} onClick={() => void copyEdits(view, showToast)}>
              내 수정 내용 복사
            </button>
            <button type="button" className={styles.primary} onClick={editor.discard}>
              새로 불러오기
            </button>
          </span>
        </div>
      )}
      {log?.status === 'CONFIRMED' && log.sourceChangedAfterConfirm && (
        <p className={styles.notice} role="note">
          원본이 바뀌었어요(확정 일지는 그대로)
        </p>
      )}

      {query.isPending ? (
        <Skeleton shape="block" height={480} offlineText="연결되면 일지를 불러올게요" />
      ) : query.isError || !log || !view ? (
        <div className={styles.failed}>
          <p>일지를 불러오지 못했어요.</p>
          <button type="button" className={styles.secondary} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </div>
      ) : (
        <div className={styles.layout}>
          <LogPaper
            type={type}
            periodStart={log.periodStart}
            periodEnd={log.periodEnd}
            content={view}
            draft={log.status !== 'CONFIRMED'}
            confirmedAt={log.confirmedAt}
            timeZone={timeZone}
            editor={paperEditor}
            projectName={(id) => projects.data?.find((p) => p.id === id)?.name ?? null}
          />
          {paperEditor && (
            <SourceRecords
              from={log.periodStart}
              to={log.periodEnd}
              achievements={view.achievements}
              onAdd={(record, name) =>
                editor.change({ achievements: [...view.achievements, fromRecord(record, name)] })
              }
              projectName={(id) => projects.data?.find((p) => p.id === id)?.name ?? null}
            />
          )}
        </div>
      )}

      {dialog === 'refill' && log && (
        <ConfirmDialog
          title="원본에서 다시 채울까요?"
          body="직접 고친 실적이 지금 기록으로 바뀌어요. 계획과 이슈는 그대로예요."
          action="다시 채우기"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            // 아직 보내지 않은 실적 수정은 버린다(다시 채우면 어차피 사라짐). 계획·이슈는 먼저 저장
            if (editor.edits?.achievements) editor.change({ achievements: undefined })
            void run((l) => logApi.refill(l.id!, l.version), '실적을 원본에서 다시 채웠어요')
          }}
        />
      )}
      {dialog === 'unconfirm' && log && (
        <ConfirmDialog
          title="확정을 해제할까요?"
          body="이미 제출한 일지와 달라질 수 있어요. 확정본 내용이 그대로 초안이 되고, 원본 기록을 다시 반영하려면 '원본에서 다시 채우기'를 쓰세요."
          action="확정 해제"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void run((l) => logApi.unconfirm(l.id!, l.version), '확정을 해제했어요. 초안으로 고칠 수 있어요')
          }
        />
      )}
      {dialog === 'revisions' && log?.id && (
        <RevisionsDialog log={log} timeZone={timeZone} onClose={() => setDialog(null)} />
      )}
      {dialog === 'export' && log && view && (
        <ExportDialog log={{ ...log, content: view }} timeZone={timeZone} onClose={() => setDialog(null)} />
      )}
      {askProfile && user && (
        <ProfilePrompt
          user={user}
          logKey={`${type}-${start}`}
          type={type}
          start={start}
          end={log?.periodEnd ?? start}
          onDone={() => setAskProfile(false)}
        />
      )}
    </div>
  )
}

function SaveText({ state }: { state: ReturnType<typeof useLogEditor>['state'] }) {
  const text = { idle: '', saving: '저장 중…', saved: '저장됨', error: '저장하지 못했어요', conflict: '' }[state]
  return <span className={state === 'error' ? styles.saveError : styles.saveText}>{text}</span>
}

function fromRecord(r: WorkRecord, projectName: string | null): LogAchievement {
  return {
    id: crypto.randomUUID(),
    source: 'RECORD',
    text: r.content,
    result: r.result ?? null,
    outcome: r.outcome ?? null,
    progress: r.progress ?? null,
    taskId: r.taskId ?? null,
    projectName,
    recordIds: [r.id],
    dates: [r.workDate],
    durationMin: null,
  }
}

async function copyEdits(
  view: { achievements: LogAchievement[]; plans: { text: string }[]; issues: string | null } | undefined,
  showToast: (m: string) => void,
) {
  if (!view) return
  const text = [
    '[실적]',
    ...view.achievements.map((a, i) => `${i + 1}. ${a.text}${a.result ? ` — ${a.result}` : ''}`),
    '[계획]',
    ...view.plans.map((p, i) => `${i + 1}. ${p.text}`),
    '[이슈]',
    view.issues ?? '',
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    showToast('내 수정 내용을 복사했어요')
  } catch {
    showToast('복사하지 못했어요')
  }
}

/** ④ 이 기간 원본 기록(확정). 이미 실적에 들어간 기록은 표시만 */
function SourceRecords(props: {
  from: string
  to: string
  achievements: LogAchievement[]
  onAdd: (r: WorkRecord, projectName: string | null) => void
  projectName: (id: string | null) => string | null
}) {
  const records = useQuery({
    queryKey: ['records', 'range', props.from, props.to, 'CONFIRMED'],
    queryFn: () => logApi.records(props.from, props.to),
    select: (d) => d.items,
  })
  const used = new Set(props.achievements.flatMap((a) => a.recordIds))
  const asideRef = useRef<HTMLElement>(null)
  // 누른 버튼이 '실적에 있음'으로 바뀌므로 다음 기록의 [실적에 넣기]로, 없으면 추가된 실적 줄로
  const add = (r: WorkRecord, i: number) => {
    props.onAdd(r, props.projectName(r.projectId ?? null))
    const next = records.data?.slice(i + 1).find((x) => !used.has(x.id))
    requestAnimationFrame(() => {
      const aside = asideRef.current
      const button = next && aside?.querySelector<HTMLElement>(`[data-record="${next.id}"]`)
      const rows = aside?.parentElement?.querySelectorAll<HTMLElement>('[data-field="text"]')
      ;(button || rows?.[rows.length - 1])?.focus()
    })
  }
  return (
    <aside ref={asideRef} className={styles.sources} aria-labelledby="log-sources-title">
      <h2 id="log-sources-title" className={styles.sourcesTitle}>
        이 기간 기록
      </h2>
      {records.isPending ? (
        <Skeleton count={3} />
      ) : records.isError ? (
        <p className={styles.muted}>기록을 불러오지 못했어요.</p>
      ) : records.data.length === 0 ? (
        <p className={styles.muted}>이 기간에 확정한 기록이 없어요.</p>
      ) : (
        <ul className={styles.sourceList}>
          {records.data.map((r, i) => (
            <li key={r.id} className={styles.source}>
              <span className={styles.sourceText}>{r.content}</span>
              {r.result && <span className={styles.muted}>{r.result}</span>}
              {used.has(r.id) ? (
                <span className={styles.sourceUsed}>실적에 있음</span>
              ) : (
                <button
                  type="button"
                  className={styles.sourceAdd}
                  data-record={r.id}
                  aria-label={`${r.content} 실적에 넣기`}
                  onClick={() => add(r, i)}
                >
                  실적에 넣기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

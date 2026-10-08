// SCR-LOG-02 ② 문서 영역: 내보낼 파일과 같은 모습(docs/업무일지_서식명세.md, 화면 px = pt × 1.35).
// 테마 색을 쓰지 않는다. 초안을 고칠 수 있을 때만(editor) 칸이 입력으로 바뀌고 줄 버튼·계획 후보 칩이 붙는다.
import { useEffect, useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { WEEKDAY_NAMES, isoWeekday, todayIn } from '../quickInput/dates'
import type { LogAchievement, LogContent, LogPlan, LogType, PlanCandidate } from './api'
import { durationLabel, progressLabel } from './api'
import { periodText, stamp } from './format'
import { SECTION, md, mdw, metricsLine, planWhen } from './logText'
import styles from './paper.module.css'

export interface PaperEditor {
  candidates: PlanCandidate[]
  onAchievements: (next: LogAchievement[]) => void
  onPlans: (next: LogPlan[]) => void
  onIssues: (next: string) => void
}

interface Props {
  type: LogType
  periodStart: string
  periodEnd: string
  content: LogContent
  /** 초안·미리보기는 "초안" 표시와 바닥글 "초안 — 확정 전 일지" */
  draft: boolean
  confirmedAt: string | null
  timeZone: string
  editor?: PaperEditor
  /** 프로젝트 이름(소요시간 표) */
  projectName?: (id: string | null) => string | null
}

const newId = () => crypto.randomUUID()

export function LogPaper(props: Props) {
  const { type, content, draft, editor } = props
  const c = content
  const withProject = c.achievements.some((a) => a.projectName)
  const pending = c.metrics.pendingCount
  return (
    <article className={styles.paper} aria-label="일지 문서">
      <header className={styles.head}>
        <h2 className={styles.docTitle}>
          {c.title}
          {draft && <span className={styles.draftMark}>초안</span>}
        </h2>
        <table className={styles.sign} aria-label="결재란">
          <tbody>
            <tr>
              <th scope="col">담당</th>
              <th scope="col">팀장</th>
              <th scope="col">부서장</th>
            </tr>
            <tr>
              <td />
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </header>

      <table className={styles.info}>
        <tbody>
          <tr>
            <th scope="row">{type === 'DAILY' ? '일자' : '기간'}</th>
            <td>{periodText(type, props.periodStart, props.periodEnd)}</td>
            <th scope="row">작성자</th>
            <td>{profileValue(c.author.name, '이름')}</td>
          </tr>
          <tr>
            <th scope="row">소속</th>
            <td>{profileValue(c.author.organization, '소속')}</td>
            <th scope="row">직책</th>
            <td>{profileValue(c.author.position, '직책')}</td>
          </tr>
        </tbody>
      </table>

      {type === 'WEEKLY' && <WeekDays days={c.days} today={todayIn(props.timeZone)} />}
      {type === 'MONTHLY' && <MonthDays days={c.days} />}

      <Section title={SECTION[type]}>
        <Achievements type={type} rows={c.achievements} withProject={withProject} editor={editor} />
        {pending > 0 && <p className={styles.aux}>확인 대기 {pending}건은 실적에 넣지 않았어요</p>}
      </Section>

      <Section title="진행 현황">
        <p className={styles.body}>{metricsLine(type, c)}</p>
        {type === 'MONTHLY' && c.projects.length > 0 && <ProjectStats content={c} />}
      </Section>

      <Section title={c.planTitle}>
        <Plans plans={c.plans} editor={editor} timeZone={props.timeZone} />
      </Section>

      <Section title="이슈 및 특이사항">
        {editor ? (
          <textarea
            className={`${styles.issueBox} ${styles.issueInput}`}
            aria-label="이슈 및 특이사항"
            value={c.issues ?? ''}
            maxLength={2000}
            onChange={(e) => editor.onIssues(e.target.value)}
          />
        ) : (
          <div className={styles.issueBox}>{c.issues}</div>
        )}
      </Section>

      {c.time && c.time.tasks.length > 0 && (
        <Section title="소요시간">
          <TimeTable content={c} projectName={props.projectName} />
        </Section>
      )}

      <footer className={styles.foot}>
        <span>{draft ? '초안 — 확정 전 일지' : `확정 ${stamp(props.confirmedAt, props.timeZone)}`}</span>
        <span>worklog</span>
      </footer>
    </article>
  )
}

function fit(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}

/**
 * 표 칸 편집: 긴 글이 칸 안에서 줄바꿈되고 높이가 내용에 맞는다(서식명세 2.4, 말줄임 없음).
 * 한 줄 값이라 Enter·붙여 넣은 줄바꿈은 넣지 않는다
 */
function CellText({
  value,
  onValue,
  ...rest
}: { value: string; onValue: (next: string) => void } & Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
    'data-field'?: string
    'data-plan'?: boolean
  }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => fit(ref.current), [value])
  // 칸 폭이 바뀌면(창 크기·다른 칸 내용) 줄 수가 달라지므로 다시 맞춘다. 높이만 바뀐 알림은 같은 값이 나와 멈춘다
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      className={styles.cellInput}
      value={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
      }}
      onChange={(e) => onValue(e.target.value.replace(/\r?\n/g, ' '))}
    />
  )
}

function profileValue(value: string | null, label: string) {
  return value || <span className={styles.blank}>[{label}]</span>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

// 서식명세 2.3: 구분 제목은 보이지 않고(표 이름으로만), 오늘 이후 날의 '기록 없음'은 빈칸
function WeekDays({ days, today }: { days: LogContent['days']; today: string }) {
  const label = (d: LogContent['days'][number]) =>
    d.source === 'CONFIRMED_LOG'
      ? '확정'
      : d.source === 'RECORDS'
        ? '원본 기록'
        : !d.workday
          ? '휴일'
          : d.date > today
            ? ''
            : '기록 없음'
  const titleId = useId()
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.srOnly}>
        포함된 날
      </h3>
      <table className={`${styles.grid} ${styles.days}`}>
        <thead>
          <tr>
            {days.map((d) => (
              <th key={d.date} scope="col">
                {mdw(d.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {days.map((d) => (
              <td key={d.date} className={d.source === 'RECORDS' ? styles.strong : undefined}>
                {label(d)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {days.some((d) => d.source === 'RECORDS') && (
        <p className={styles.note}>원본 기록 = 확정 전이라 그날 기록에서 가져온 날</p>
      )}
    </section>
  )
}

function MonthDays({ days }: { days: LogContent['days'] }) {
  const count = (f: (d: LogContent['days'][number]) => boolean) => days.filter(f).length
  return (
    <p className={styles.aux}>
      확정 일간 {count((d) => d.source === 'CONFIRMED_LOG')}일 · 원본 기록 {count((d) => d.source === 'RECORDS')}일 ·
      휴일 {count((d) => !d.workday)}일
    </p>
  )
}

function Achievements(props: { type: LogType; rows: LogAchievement[]; withProject: boolean; editor?: PaperEditor }) {
  const { rows, editor, type } = props
  const tableRef = useRef<HTMLTableElement>(null)
  const showProject = props.withProject
  if (rows.length === 0 && !editor) return <p className={styles.none}>없음</p>
  const set = (i: number, patch: Partial<LogAchievement>) =>
    editor!.onAchievements(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) => {
    const next = [...rows]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    editor!.onAchievements(next)
    // 옮긴 줄의 같은 버튼으로 포커스를 따라간다(끝에 닿아 버튼이 사라지면 반대쪽)
    requestAnimationFrame(() => {
      const row = tableRef.current?.querySelectorAll('tbody tr')[i + by]
      const want =
        row?.querySelector<HTMLElement>(`[data-move="${by}"]`) ?? row?.querySelector<HTMLElement>('[data-move]')
      want?.focus()
    })
  }
  const remove = (i: number) => {
    editor!.onAchievements(rows.filter((_, j) => j !== i))
    requestAnimationFrame(() => {
      const list = tableRef.current?.querySelectorAll<HTMLElement>('tbody tr [data-field="text"]')
      const target =
        list?.[Math.min(i, list.length - 1)] ?? tableRef.current?.parentElement?.querySelector('[data-add]')
      ;(target as HTMLElement | null | undefined)?.focus()
    })
  }
  const add = () => {
    editor!.onAchievements([
      ...rows,
      {
        id: newId(),
        source: 'MANUAL',
        text: '',
        result: null,
        outcome: null,
        progress: null,
        taskId: null,
        projectName: null,
        recordIds: [],
        dates: [],
        durationMin: null,
      },
    ])
    requestAnimationFrame(() => {
      const list = tableRef.current?.querySelectorAll<HTMLElement>('[data-field="text"]')
      list?.[list.length - 1]?.focus()
    })
  }
  return (
    <>
      {rows.length === 0 ? (
        <p className={styles.none}>없음</p>
      ) : (
        <table ref={tableRef} className={styles.grid}>
          <thead>
            <tr>
              <th scope="col" className={styles.no}>
                No
              </th>
              {showProject && <th scope="col">프로젝트</th>}
              <th scope="col">{type === 'DAILY' ? '업무 내용' : '업무'}</th>
              <th scope="col">결과</th>
              <th scope="col" className={styles.center}>
                진행률
              </th>
              {type === 'WEEKLY' && (
                <th scope="col" className={styles.center}>
                  한 날
                </th>
              )}
              {type === 'MONTHLY' && (
                <th scope="col" className={styles.center}>
                  기록 일수
                </th>
              )}
              {editor && (
                <th scope="col" className={styles.rowTools}>
                  <span className={styles.srOnly}>줄 편집</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={a.id}>
                <td className={styles.no}>{i + 1}</td>
                {showProject && <td>{a.projectName}</td>}
                <td>
                  {editor ? (
                    <CellText
                      data-field="text"
                      aria-label={`${i + 1}번 업무 내용`}
                      value={a.text}
                      maxLength={500}
                      onValue={(text) => set(i, { text })}
                    />
                  ) : (
                    a.text
                  )}
                </td>
                <td>
                  {editor ? (
                    <CellText
                      aria-label={`${i + 1}번 결과`}
                      value={a.result ?? ''}
                      maxLength={200}
                      onValue={(result) => set(i, { result: result || null })}
                    />
                  ) : (
                    a.result
                  )}
                </td>
                <td className={styles.center}>{progressLabel(a)}</td>
                {type === 'WEEKLY' && (
                  <td className={styles.center}>{a.dates.map((d) => WEEKDAY_NAMES[isoWeekday(d) - 1]).join('·')}</td>
                )}
                {type === 'MONTHLY' && <td className={styles.center}>{a.dates.length}일</td>}
                {editor && (
                  <td className={styles.rowTools}>
                    {i > 0 && (
                      <button
                        type="button"
                        className={styles.tool}
                        data-move="-1"
                        aria-label={`${i + 1}번 위로`}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                    )}
                    {i < rows.length - 1 && (
                      <button
                        type="button"
                        className={styles.tool}
                        data-move="1"
                        aria-label={`${i + 1}번 아래로`}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.tool}
                      aria-label={`${i + 1}번 줄 삭제`}
                      onClick={() => remove(i)}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* 계약 최대 200줄(WorkLogPatch) */}
      {editor && rows.length < 200 && (
        <button type="button" className={styles.addRow} data-add onClick={add}>
          ＋ 실적 줄 추가
        </button>
      )}
    </>
  )
}

const REASON: Record<PlanCandidate['reason'], (c: PlanCandidate) => string> = {
  IN_PROGRESS: () => '진행 중',
  OVERDUE: () => '마감 지남',
  DUE: (c) => `마감 ${c.dueDate ? md(c.dueDate) : ''}`,
}

function Plans({ plans, editor, timeZone }: { plans: LogPlan[]; editor?: PaperEditor; timeZone: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const when = (p: LogPlan) => planWhen(p, timeZone)
  const taken = new Set(plans.map((p) => p.taskId).filter(Boolean))
  const chips = editor?.candidates.filter((c) => !taken.has(c.taskId)) ?? []
  const focusAfter = (selector: string, index: number) =>
    requestAnimationFrame(() => {
      const list = listRef.current?.querySelectorAll<HTMLElement>(selector)
      const target = list?.[Math.min(index, (list?.length ?? 1) - 1)] ?? listRef.current?.querySelector('[data-add]')
      ;(target as HTMLElement | null | undefined)?.focus()
    })
  const addCandidate = (c: PlanCandidate, i: number) => {
    editor!.onPlans([...plans, { id: newId(), taskId: c.taskId, text: c.title, dueDate: c.dueDate, scheduledAt: null }])
    focusAfter('[data-chip]', i)
  }
  const addEmpty = () => {
    editor!.onPlans([...plans, { id: newId(), taskId: null, text: '', dueDate: null, scheduledAt: null }])
    focusAfter('[data-plan]', plans.length)
  }
  return (
    <div ref={listRef}>
      {plans.length === 0 ? (
        <p className={styles.none}>없음</p>
      ) : (
        <table className={styles.grid}>
          <thead>
            <tr>
              <th scope="col" className={styles.no}>
                No
              </th>
              <th scope="col">업무</th>
              <th scope="col" className={styles.planWhen}>
                예정
              </th>
              {editor && (
                <th scope="col" className={styles.rowTools}>
                  <span className={styles.srOnly}>줄 편집</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.id}>
                <td className={styles.no}>{i + 1}</td>
                <td>
                  {editor ? (
                    <CellText
                      data-plan
                      aria-label={`계획 ${i + 1}`}
                      value={p.text}
                      maxLength={200}
                      onValue={(text) => editor.onPlans(plans.map((x, j) => (j === i ? { ...x, text } : x)))}
                    />
                  ) : (
                    p.text
                  )}
                </td>
                <td className={styles.planWhen}>{when(p)}</td>
                {editor && (
                  <td className={styles.rowTools}>
                    <button
                      type="button"
                      className={styles.tool}
                      aria-label={`계획 ${i + 1} 삭제`}
                      onClick={() => {
                        editor.onPlans(plans.filter((_, j) => j !== i))
                        focusAfter('[data-plan]', i)
                      }}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editor && (
        <div className={styles.planTools}>
          {/* 계약 최대 50줄(WorkLogPatch) */}
          {chips.length > 0 && plans.length < 50 && (
            <ul className={styles.chips} aria-label="계획 후보">
              {chips.map((c, i) => (
                <li key={c.taskId}>
                  <button type="button" className={styles.chip} data-chip onClick={() => addCandidate(c, i)}>
                    <span aria-hidden="true">＋</span> {c.title}
                    <span className={styles.chipReason}>{REASON[c.reason](c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {plans.length < 50 && (
            <button type="button" className={styles.addRow} data-add onClick={addEmpty}>
              ＋ 계획 직접 쓰기
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectStats({ content }: { content: LogContent }) {
  const rows = content.projects
  const timed = rows.some((p) => p.minutes != null)
  const totalMin = rows.reduce((s, p) => s + (p.minutes ?? 0), 0)
  const share = (min: number | null) => (totalMin > 0 && min != null ? `${Math.round((min / totalMin) * 100)}%` : '')
  // 서식명세 2.5 칸 폭(mm, 본문 174): 시간 기록이 꺼지면 프로젝트 칸이 소요시간·비중 폭을 가진다
  const cols = timed ? [60, 30, 30, 34, 20] : [114, 30, 30]
  return (
    <table className={`${styles.grid} ${styles.stats}`}>
      <colgroup>
        {cols.map((mm, i) => (
          <col key={i} style={{ width: `${((mm / 174) * 100).toFixed(1)}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">프로젝트</th>
          <th scope="col" className={styles.center}>
            완료 업무
          </th>
          <th scope="col" className={styles.center}>
            기록
          </th>
          {timed && (
            <>
              <th scope="col" className={styles.center}>
                소요시간
              </th>
              <th scope="col" className={styles.center}>
                비중
              </th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.projectId ?? 'none'}>
            <td>{p.name ?? '프로젝트 없음'}</td>
            <td className={styles.center}>{p.completedTaskCount}</td>
            <td className={styles.center}>{p.recordCount}</td>
            {timed && (
              <>
                <td className={styles.center}>{durationLabel(p.minutes)}</td>
                <td className={styles.center}>{share(p.minutes)}</td>
              </>
            )}
          </tr>
        ))}
        <tr className={styles.total}>
          <td>합계</td>
          <td className={styles.center}>{rows.reduce((s, p) => s + p.completedTaskCount, 0)}</td>
          <td className={styles.center}>{rows.reduce((s, p) => s + p.recordCount, 0)}</td>
          {timed && (
            <>
              <td className={styles.center}>{durationLabel(totalMin)}</td>
              <td className={styles.center}>{totalMin > 0 ? '100%' : ''}</td>
            </>
          )}
        </tr>
      </tbody>
    </table>
  )
}

function TimeTable({
  content,
  projectName,
}: {
  content: LogContent
  projectName?: (id: string | null) => string | null
}) {
  const time = content.time!
  const share = (min: number) => (time.totalMin > 0 ? `${Math.round((min / time.totalMin) * 100)}%` : '')
  return (
    <table className={styles.grid}>
      <thead>
        <tr>
          <th scope="col">프로젝트</th>
          <th scope="col">업무</th>
          <th scope="col" className={styles.center}>
            소요시간
          </th>
          <th scope="col" className={styles.center}>
            비중
          </th>
        </tr>
      </thead>
      <tbody>
        {time.tasks.map((t) => (
          <tr key={`${t.taskId}-${t.projectId}`}>
            <td>{projectName?.(t.projectId) ?? ''}</td>
            <td>{t.taskId ? t.title : '업무 없음'}</td>
            <td className={styles.center}>{durationLabel(t.minutes)}</td>
            <td className={styles.center}>{share(t.minutes)}</td>
          </tr>
        ))}
        <tr className={styles.total}>
          <td colSpan={2}>합계</td>
          <td className={styles.center}>{durationLabel(time.totalMin)}</td>
          <td className={styles.center}>{time.totalMin > 0 ? '100%' : ''}</td>
        </tr>
      </tbody>
    </table>
  )
}

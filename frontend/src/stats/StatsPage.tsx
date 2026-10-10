// SCR-STAT-01 통계 (STAT-01, TIME-07, UX-05 · P4-02). 목업 STAT-01(넓은 화면)·STAT-01s(390·빈 상태·로딩·기간 고르기).
// 읽기 전용 화면이라 끊긴 동안에도 막을 동작이 없다. 첫 로딩만 스켈레톤(0.3초 뒤), 다시 받을 때는 지금 내용을 둔다.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { todayIn, type Weekday } from '../calendar/time'
import { useDelayed } from '../components/useDelayed'
import { useOnline } from '../components/useOnline'
import { useTimeSummary } from '../home/gaps'
import { useProjects, type Project } from '../projects/api'
import { useTimeTracking } from '../settings/useWorklogSettings'
import { usePlanVsActual, useStats, type Stats } from './api'
import { completedBuckets, projectName, readiness, weekAligned } from './buckets'
import { ProjectBars, TimeShare, WeeklyChart } from './charts'
import { count, diffText, diffTone, hoursText } from './format'
import { PeriodDialog } from './PeriodDialog'
import { rangeLabel, readPeriod, thisMonth, thisWeek, writePeriod, type Period } from './period'
import { addDays } from '../calendar/time'
import styles from './stats.module.css'

export function StatsPage() {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const weekStart = (user?.weekStart ?? 'MONDAY') as Weekday
  const today = todayIn(timeZone)
  const [search, setSearch] = useSearchParams()
  const period = readPeriod(search, today, weekStart)
  const [picking, setPicking] = useState(false)
  const choose = (next: Period) => setSearch(writePeriod(next), { replace: true })

  const stats = useStats(period.from, period.to)

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>통계</h1>
        <div role="group" aria-label="기간" className={styles.segment}>
          <button
            type="button"
            aria-pressed={period.kind === 'week'}
            onClick={() => choose(thisWeek(today, weekStart))}
          >
            이번 주
          </button>
          <button type="button" aria-pressed={period.kind === 'month'} onClick={() => choose(thisMonth(today))}>
            이번 달
          </button>
          {/* 고른 뒤에는 기간을 보인다. 이름은 보이는 글자를 담은 채 "직접 선택"을 앞에 붙인다(2.5.3) */}
          <button
            type="button"
            aria-pressed={period.kind === 'custom'}
            aria-haspopup="dialog"
            aria-label={period.kind === 'custom' ? `직접 선택 ${rangeLabel(period.from, period.to, today)}` : undefined}
            onClick={() => setPicking(true)}
          >
            {period.kind === 'custom' ? rangeLabel(period.from, period.to, today) : '직접 선택'}
          </button>
        </div>
      </div>
      {picking && (
        <PeriodDialog
          from={period.from}
          to={period.to}
          today={today}
          weekStart={weekStart}
          onClose={() => setPicking(false)}
          onApply={(from, to) => {
            setPicking(false)
            choose({ kind: 'custom', from, to })
          }}
        />
      )}
      {/* 다시 받다 실패해도 받아 둔 내용은 그대로 둔다 */}
      {stats.data ? (
        <StatsBody report={stats.data} today={today} weekStart={weekStart} />
      ) : stats.isPending ? (
        <StatsLoading />
      ) : (
        <section role="alert" className={`${styles.card} ${styles.errorRow}`}>
          <span className={styles.errorText}>통계를 불러오지 못했어요</span>
          <button type="button" className={styles.softButton} onClick={() => void stats.refetch()}>
            다시 시도
          </button>
        </section>
      )}
    </div>
  )
}

function StatsLoading() {
  const shown = useDelayed()
  const online = useOnline()
  if (!shown) return null
  if (!online)
    return (
      <p role="status" className={styles.muted}>
        연결되면 통계를 불러올게요
      </p>
    )
  return (
    <div role="status" className={styles.loading}>
      <span className="visually-hidden">통계 불러오는 중</span>
      <div className={styles.summary} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.summaryCard}>
            <span className={styles.sk} style={{ width: '60%', height: 12 }} />
            <span className={styles.sk} style={{ width: '50%', height: 28, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className={styles.card} aria-hidden="true">
        <span className={styles.sk} style={{ width: '40%', height: 14 }} />
        <div className={styles.skBars}>
          {[60, 85, 70, 40, 55].map((h) => (
            <span key={h} className={styles.sk} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function StatsBody({ report, today, weekStart }: { report: Stats; today: string; weekStart: Weekday }) {
  const timeTracking = useTimeTracking()
  const projects = useProjects().data ?? []

  const ready = readiness(report.firstRecordDate, today)
  if (!ready.ready) {
    return (
      <section aria-labelledby="stats-not-ready" className={`${styles.card} ${styles.empty}`}>
        <svg
          aria-hidden="true"
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.emptyIcon}
        >
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
        <h2 id="stats-not-ready" className={styles.emptyTitle}>
          1주일 기록이 쌓이면 보여 드려요
        </h2>
        <p className={styles.muted}>
          {ready.daysLeft !== null && `앞으로 ${ready.daysLeft}일 남았어요. `}그동안은 홈에서 기록을 확인해 주세요.
        </p>
        <Link to="/" className={styles.primaryLink}>
          홈으로
        </Link>
      </section>
    )
  }

  const nothing = report.completedTaskCount === 0 && report.recordCount === 0 && report.confirmedLogCount === 0
  if (nothing) {
    return (
      <section aria-labelledby="stats-nothing" className={`${styles.card} ${styles.empty}`}>
        <h2 id="stats-nothing" className={styles.emptyTitle}>
          이 기간에는 기록이 없어요
        </h2>
        <p className={styles.muted}>다른 기간을 골라 보세요.</p>
      </section>
    )
  }

  const buckets = completedBuckets(report.daily, weekStart, today)
  const chartTitle = buckets[0]?.key.length === 7 ? '달별 완료 업무' : '주별 완료 업무'
  // 기록만 있고 완료가 없는 프로젝트는 완료 막대에서 뺀다
  const completedProjects = report.projects.filter((p) => p.completedTaskCount > 0)
  return (
    <>
      <ul className={styles.summary} aria-label="요약">
        <li className={`${styles.summaryCard} ${styles.summaryAccent}`}>
          <span className={styles.summaryLabel}>완료 업무</span>
          <span className={styles.summaryValue}>{count(report.completedTaskCount)}</span>
        </li>
        <li className={styles.summaryCard}>
          <span className={styles.summaryLabel}>확정 일지</span>
          <span className={styles.summaryValue}>{count(report.confirmedLogCount)}</span>
        </li>
        <li className={styles.summaryCard}>
          <span className={styles.summaryLabel}>업무 기록</span>
          <span className={styles.summaryValue}>{count(report.recordCount)}</span>
        </li>
      </ul>
      <div className={styles.row}>
        <section aria-labelledby="stats-weekly" className={`${styles.card} ${styles.wide}`}>
          <h2 id="stats-weekly" className={styles.cardTitle}>
            {chartTitle}
          </h2>
          <WeeklyChart buckets={buckets} title={chartTitle} />
        </section>
        <section aria-labelledby="stats-projects" className={`${styles.card} ${styles.narrow}`}>
          <h2 id="stats-projects" className={styles.cardTitle}>
            프로젝트별 완료
          </h2>
          {completedProjects.length ? (
            <ProjectBars rows={completedProjects} projects={projects} />
          ) : (
            <p className={styles.muted}>이 기간에 완료한 업무가 없어요</p>
          )}
        </section>
      </div>
      {timeTracking ? (
        <TimeSection report={report} projects={projects} today={today} weekStart={weekStart} />
      ) : (
        <section aria-labelledby="stats-retro-off" className={styles.card}>
          <h2 id="stats-retro-off" className={styles.cardTitle}>
            주간 회고 · 예상 대비 실제
          </h2>
          <p className={styles.muted}>예상과 실제를 비교하려면 시간 기록을 켜 주세요.</p>
          <Link to="/settings/recording" className={styles.textLink}>
            기록 옵션 열기
          </Link>
        </section>
      )}
    </>
  )
}

function TimeSection(props: { report: Stats; projects: Project[]; today: string; weekStart: Weekday }) {
  const { report, projects, today } = props
  const summary = useTimeSummary(report.from, report.to)
  const share = summary.data?.projects.filter((p) => p.minutes > 0) ?? []
  const aligned = weekAligned(report.from, report.to, props.weekStart)
  const plan = usePlanVsActual(aligned.from, aligned.to, true)
  const retro = plan.data
  // 예상도 실제도 없는 주는 줄을 만들지 않는다
  const retroWeeks = retro?.weeks.filter((w) => w.plannedMin > 0 || w.actualMin > 0) ?? []
  return (
    <>
      <p className={styles.timeNote}>
        <span className={styles.timeTag}>시간 기록 켜짐</span>켜져 있을 때만 보이는 통계
      </p>
      <div className={styles.row}>
        <section aria-labelledby="stats-share" className={`${styles.card} ${styles.narrow}`}>
          <h2 id="stats-share" className={styles.cardTitle}>
            소요시간 비중
          </h2>
          {summary.isPending ? (
            <p className={styles.muted}>불러오는 중…</p>
          ) : summary.isError ? (
            <p className={styles.muted}>소요시간을 불러오지 못했어요</p>
          ) : share.length ? (
            <TimeShare rows={share} projects={projects} />
          ) : (
            <p className={styles.muted}>이 기간에 시간을 남긴 기록이 없어요</p>
          )}
        </section>
        <section aria-labelledby="stats-retro" className={`${styles.card} ${styles.wide}`}>
          <h2 id="stats-retro" className={styles.cardTitle}>
            주간 회고 · 예상 대비 실제
          </h2>
          <p className={styles.muted}>일정에 잡아 둔 시간(예상)과 확정 기록 시간(실제)을 주마다 비교해요</p>
          {plan.isPending ? (
            <p className={styles.muted}>불러오는 중…</p>
          ) : plan.isError ? (
            <p role="alert" className={styles.muted}>
              예상 대비 실제를 불러오지 못했어요{' '}
              <button type="button" className={styles.inlineButton} onClick={() => void plan.refetch()}>
                다시 시도
              </button>
            </p>
          ) : retro && retroWeeks.length ? (
            <>
              {/* 좁은 화면에서는 표만 상자 안에서 가로로 민다. 키보드로도 밀 수 있게 포커스를 받는다 */}
              <div className={styles.tableBox} role="region" aria-label="주별 예상 대비 실제 표" tabIndex={0}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">주</th>
                      <th scope="col">예상</th>
                      <th scope="col">실제</th>
                      <th scope="col">차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retroWeeks.map((w) => (
                      <tr key={w.weekStart}>
                        <th scope="row">{rangeLabel(w.weekStart, addDays(w.weekStart, 6), today)}</th>
                        <td className={styles.mutedCell}>{hoursText(w.plannedMin)}</td>
                        <td>{hoursText(w.actualMin)}</td>
                        <td className={styles[diffTone(w.plannedMin, w.actualMin)]}>
                          {diffText(w.plannedMin, w.actualMin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {retro.topDiffs.length > 0 && (
                <>
                  <h3 className={styles.subTitle}>차이가 큰 업무 상위 {retro.topDiffs.length}</h3>
                  <ul className={styles.overList}>
                    {retro.topDiffs.map((t) => (
                      <li key={t.taskId}>
                        <Link to={`/tasks/${t.taskId}`} className={styles.overRow}>
                          <span className={styles.overTitle}>
                            {t.title}
                            <span className="visually-hidden"> · {projectName(projects, t.projectId)}</span>
                          </span>
                          <span className={styles.mutedCell}>예상 {hoursText(t.plannedMin)}</span>
                          <span>실제 {hoursText(t.actualMin)}</span>
                          <span className={styles[diffTone(t.plannedMin, t.actualMin)]}>
                            {diffText(t.plannedMin, t.actualMin)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className={styles.footnote}>예상 시간이 없는(일정 없이 만든) 업무는 세지 않아요</p>
            </>
          ) : (
            <p className={styles.muted}>이 기간에는 일정에 잡아 둔 업무가 없어 비교할 수 없어요</p>
          )}
        </section>
      </div>
    </>
  )
}

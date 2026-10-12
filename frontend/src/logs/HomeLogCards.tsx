// SCR-HOME-01 ⑤ 오늘 마감 · ⑦ 이번 주 마감 (P3-04, LOG-01·16). 업무일지 숨김(사용자 결정 2026-10-12, docs/ux/업무일지숨김_문안_v1.md 2장):
// '일지'라는 말과 일지 화면·내보내기로 가는 길을 빼고 하루 마감 현황만 보인다.
// ⑤ 확정 기록·내일 계획·이슈 수, 확정 전에는 [하루 마감]. 확정하면 "마감함"과 마감 시각.
// ⑦ 이번 주 날마다 마감함/마감 전/기록 없음/예정/휴일(누르는 곳 없음).
import { addDays, isoWeekday, WEEKDAY_NAMES } from '../quickInput/dates'
import { Skeleton } from '../components/Skeleton'
import { formatMinutes, toZoned } from '../format/datetime'
import home from '../home/home.module.css'
import { useLog, useLogPeriods, type LogPeriod, type LogStatus } from './api'
import { openDayClose } from './openDayClose'
import { LogStatusLegend } from './LogStatusLegend'
import styles from './logs.module.css'

/** hideClose: 홈 마감 띠가 떠 있을 때 [하루 마감]을 숨긴다(띠와 중복, X-02). 띠 전에는 채움이 아니라 accent-soft */
export function TodayLogCard({
  today,
  timeZone,
  hideClose = false,
}: {
  today: string
  timeZone: string
  hideClose?: boolean
}) {
  const log = useLog('DAILY', today)
  const data = log.data
  const c = data?.content
  const confirmed = data?.status === 'CONFIRMED'

  return (
    <section aria-labelledby="home-log-today" className={home.panel}>
      <div className={home.panelHead}>
        <h2 id="home-log-today" className={home.panelTitle}>
          오늘 마감
        </h2>
        {confirmed && <span className={`${styles.badge} ${styles.badgeCONFIRMED}`}>마감함</span>}
      </div>
      {log.isPending ? (
        <Skeleton count={2} />
      ) : log.isError || !c ? (
        <p role="alert" className={home.error}>
          마감 정보를 불러오지 못했어요.
          <button type="button" className={styles.secondary} onClick={() => void log.refetch()}>
            다시 시도
          </button>
        </p>
      ) : (
        <>
          <p className={styles.fillText}>
            확정 기록 {c.achievements.length}건 · {c.planTitle} {c.plans.length}건 · 이슈{' '}
            {c.issues?.trim() ? '있음' : '없음'}
          </p>
          {confirmed && data.confirmedAt ? (
            <p className={home.muted}>{formatMinutes(toZoned(data.confirmedAt, timeZone).minutes)}에 마감했어요</p>
          ) : (
            data.status === 'NO_RECORDS' && <p className={home.muted}>아직 확정한 기록이 없어요</p>
          )}
          {!confirmed && !hideClose && (
            <div className={styles.cardActions}>
              <button type="button" className={styles.softButton} aria-haspopup="dialog" onClick={() => openDayClose()}>
                하루 마감
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const DAY_LABEL = { CONFIRMED: '마감함', DRAFT: '마감 전', NOT_WRITTEN: '마감 전', NO_RECORDS: '기록 없음' } as const
/** 작성 중·미작성은 '마감 전' 하나라 칸 모양도 하나(초안의 고리)로 */
const DAY_CELL: Record<LogStatus, LogStatus> = {
  CONFIRMED: 'CONFIRMED',
  DRAFT: 'DRAFT',
  NOT_WRITTEN: 'DRAFT',
  NO_RECORDS: 'NO_RECORDS',
}
const LEGEND = [
  ['CONFIRMED', '마감함'],
  ['DRAFT', '마감 전'],
  ['NO_RECORDS', '기록 없음'],
] as const

function dayLabel(p: LogPeriod, today: string): string {
  if (p.workday === false) return p.holiday ?? '휴일'
  if (p.periodStart > today) return '예정'
  return DAY_LABEL[p.status]
}

export function WeekLogStatus({ today, weekFirst }: { today: string; weekFirst: string }) {
  const weekLast = addDays(weekFirst, 6)
  const days = useLogPeriods('DAILY', weekFirst, weekLast)
  return (
    <section aria-labelledby="home-log-week" className={home.panel}>
      <div className={home.panelHead}>
        <h2 id="home-log-week" className={home.panelTitle}>
          이번 주 마감
        </h2>
      </div>
      {days.isPending ? (
        <Skeleton shape="line" />
      ) : days.isError ? (
        <p role="alert" className={home.error}>
          마감 현황을 불러오지 못했어요.
          <button type="button" className={styles.secondary} onClick={() => void days.refetch()}>
            다시 시도
          </button>
        </p>
      ) : (
        <div className={styles.weekDaysBox}>
          <ul className={styles.weekDays}>
            {days.data.items.map((p) => {
              const label = dayLabel(p, today)
              const weekday = WEEKDAY_NAMES[isoWeekday(p.periodStart) - 1]
              const cls = [
                styles.weekDay,
                p.workday === false && styles.cellOff,
                p.periodStart === today && styles.cellToday,
                styles[`cell${DAY_CELL[p.status]}`],
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={p.periodStart}>
                  <span className={cls} aria-current={p.periodStart === today ? 'date' : undefined}>
                    <span className={styles.srOnly}>
                      {Number(p.periodStart.slice(5, 7))}월 {Number(p.periodStart.slice(8))}일{' '}
                    </span>
                    <span className={styles.dayNo}>
                      {weekday}
                      <span className={styles.srOnly}>요일 </span>
                    </span>
                    <span className={styles.cellStatus}>{label}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {/* 390에서는 칸이 기호만 보여 범례를 둔다(UX-HOME-06, 일지 목록 LOG-52와 같은 범례) */}
          <LogStatusLegend items={LEGEND} />
        </div>
      )}
    </section>
  )
}

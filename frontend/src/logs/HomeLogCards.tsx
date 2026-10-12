// SCR-HOME-01 ⑤ 오늘 일지 미리보기 · ⑦ 이번 주 일지 현황 (P3-04, LOG-01·16).
// ⑤ 채움 정도(실적·계획·이슈), [일지 보기]·[하루 마감]. 확정하면 "확정됨"과 확정 시각, [하루 마감] 자리에 [내보내기].
// ⑦ 이번 주 날마다 확정/작성 중/미작성/기록 없음/예정/휴일, 날을 누르면 그날 일지.
import { useState } from 'react'
import { Link } from 'react-router'
import { addDays, isoWeekday, WEEKDAY_NAMES } from '../quickInput/dates'
import { Skeleton } from '../components/Skeleton'
import home from '../home/home.module.css'
import { logHref, useLog, useLogPeriods, type LogPeriod } from './api'
import { ExportDialog } from './ExportDialog'
import { openDayClose } from './openDayClose'
import { stamp } from './format'
import { LogStatusLegend } from './LogStatusLegend'
import styles from './logs.module.css'

/** hideClose: 홈 마감 띠가 떠 있을 때 [하루 마감]을 숨긴다(띠와 중복, X-02). 띠 전에는 채움이 아니라 accent-soft */
export function TodayLogCard({
  today,
  timeZone,
  hideClose = false,
  hideView = false,
}: {
  today: string
  timeZone: string
  hideClose?: boolean
  /** 확정 띠가 [일지 보기]를 보이면 카드의 것은 뺀다(중복, UX-HOME-140) */
  hideView?: boolean
}) {
  const log = useLog('DAILY', today)
  const [exporting, setExporting] = useState(false)
  const data = log.data
  const c = data?.content
  const parts = c ? [c.achievements.length > 0, c.plans.length > 0, !!c.issues?.trim()] : []
  const filled = parts.filter(Boolean).length
  const confirmed = data?.status === 'CONFIRMED'

  return (
    <section aria-labelledby="home-log-today" className={home.panel}>
      <div className={home.panelHead}>
        <h2 id="home-log-today" className={home.panelTitle}>
          오늘 일지
        </h2>
        {confirmed && <span className={`${styles.badge} ${styles.badgeCONFIRMED}`}>확정됨</span>}
        {data?.status === 'DRAFT' && <span className={`${styles.badge} ${styles.badgeDRAFT}`}>초안</span>}
      </div>
      {log.isPending ? (
        <Skeleton count={2} />
      ) : log.isError || !c ? (
        <p role="alert" className={home.error}>
          일지를 불러오지 못했어요.
          <button type="button" className={styles.secondary} onClick={() => void log.refetch()}>
            다시 시도
          </button>
        </p>
      ) : (
        <>
          <div className={styles.fill}>
            <span className={styles.fillBar} aria-hidden="true">
              {parts.map((on, i) => (
                <span key={i} className={on ? styles.fillOn : undefined} />
              ))}
            </span>
            <span className={styles.fillText}>
              실적 {c.achievements.length}건 · 계획 {c.plans.length}건 · 이슈 {c.issues?.trim() ? '있음' : '없음'}
            </span>
          </div>
          <p className={home.muted}>
            {confirmed
              ? `확정 ${stamp(data.confirmedAt, timeZone)}`
              : data.status === 'NO_RECORDS'
                ? '아직 확정한 기록이 없어요. 기록을 확정하면 실적에 들어가요.'
                : `${filled}/3칸 채웠어요`}
          </p>
          <div className={styles.cardActions}>
            {!hideView && (
              <Link to={logHref('DAILY', today)} className={styles.secondaryLink}>
                일지 보기
              </Link>
            )}
            {confirmed ? (
              // 홈 한 시야의 채움은 마감 띠 하나다. 카드의 [내보내기]는 윤곽(X-02, UX-HOME-140)
              <button
                type="button"
                className={styles.secondary}
                aria-haspopup="dialog"
                onClick={() => setExporting(true)}
              >
                내보내기
              </button>
            ) : (
              !hideClose && (
                <button
                  type="button"
                  className={styles.softButton}
                  aria-haspopup="dialog"
                  onClick={() => openDayClose()}
                >
                  하루 마감
                </button>
              )
            )}
          </div>
        </>
      )}
      {exporting && data && <ExportDialog log={data} timeZone={timeZone} onClose={() => setExporting(false)} />}
    </section>
  )
}

const DAY_LABEL = { CONFIRMED: '확정', DRAFT: '작성 중', NOT_WRITTEN: '미작성', NO_RECORDS: '기록 없음' } as const

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
          이번 주 일지
        </h2>
        <Link to={logHref('WEEKLY', weekFirst)} className={styles.headLink}>
          주간 일지
        </Link>
      </div>
      {days.isPending ? (
        <Skeleton shape="line" />
      ) : days.isError ? (
        <p role="alert" className={home.error}>
          일지 현황을 불러오지 못했어요.
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
                styles[`cell${p.status}`],
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={p.periodStart}>
                  <Link
                    to={logHref('DAILY', p.periodStart)}
                    className={cls}
                    aria-label={`${Number(p.periodStart.slice(5, 7))}월 ${Number(p.periodStart.slice(8))}일 ${weekday}요일 ${label}`}
                    aria-current={p.periodStart === today ? 'date' : undefined}
                  >
                    <span className={styles.dayNo}>{weekday}</span>
                    <span className={styles.cellStatus}>{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {/* 390에서는 칸이 기호만 보여 범례를 둔다(UX-HOME-06, 일지 목록 LOG-52와 같은 범례) */}
          <LogStatusLegend />
        </div>
      )}
    </section>
  )
}

// SCR-LOG-01 일지 목록 (P3-08, LOG-09·16). ① 탭 일간/주간/월간 ② 일간 월 달력(날짜별 상태, 공휴일 이름, 주말·공휴일 흐림)
// ③ 주간 행(기간·상태·확정 n/m일) ④ 월간 행 ⑤ 상단 띠 "확정 안 된 날 n일".
// 미작성 날짜를 누르면 초안을 만든 뒤 연다. 탭·달은 주소(?view=·?month=·?year=)에 둔다(뒤로 가기로 돌아오게).
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { addMonths, daysInMonth } from '../calendar/time'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { isoWeekday, todayIn, WEEKDAY_NAMES, weekStartNumber } from '../quickInput/dates'
import { logApi, logHref, storeLog, useLogPeriods, type LogPeriod, type LogType } from './api'
import { periodText, STATUS_LABEL } from './format'
import styles from './logs.module.css'

const VIEWS: { key: string; type: LogType; label: string }[] = [
  { key: 'daily', type: 'DAILY', label: '일간' },
  { key: 'weekly', type: 'WEEKLY', label: '주간' },
  { key: 'monthly', type: 'MONTHLY', label: '월간' },
]

export function LogListPage() {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const today = todayIn(timeZone)
  const weekStart = weekStartNumber(user?.weekStart)
  const [params, setParams] = useSearchParams()
  const view = VIEWS.find((v) => v.key === params.get('view')) ?? VIEWS[0]
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : today.slice(0, 7)
  const year = /^\d{4}$/.test(params.get('year') ?? '') ? params.get('year')! : today.slice(0, 4)

  const go = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) merged.set(k, v)
    setParams(merged)
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>업무일지</h1>
      <nav className={styles.tabs} aria-label="일지 종류">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            to={`?${new URLSearchParams({ ...Object.fromEntries(params), view: v.key })}`}
            className={v === view ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={v === view ? 'page' : undefined}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view.type === 'MONTHLY' ? (
        <YearRows year={year} today={today} onYear={(y) => go({ year: y })} />
      ) : (
        <MonthPeriods
          type={view.type}
          month={month}
          today={today}
          weekStart={weekStart}
          onMonth={(m) => go({ month: m })}
        />
      )}
    </div>
  )
}

function Stepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className={styles.periodNav}>
      <button type="button" className={styles.navButton} aria-label="이전" onClick={onPrev}>
        ‹
      </button>
      <h2 className={styles.stepLabel} aria-live="polite">
        {label}
      </h2>
      <button type="button" className={styles.navButton} aria-label="다음" onClick={onNext}>
        ›
      </button>
    </div>
  )
}

/** 미작성은 초안을 만든 뒤 연다 */
function useOpenPeriod() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (p: LogPeriod) => {
    if (p.status !== 'NOT_WRITTEN') return navigate(logHref(p.type, p.periodStart))
    setOpening(p.periodStart)
    try {
      storeLog(queryClient, await logApi.create(p.type, p.periodStart))
      void navigate(logHref(p.type, p.periodStart))
    } catch {
      showToast('초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요')
      setOpening(null)
    }
  }
  return { open, opening }
}

function UnconfirmedBand({ count }: { count: number | undefined }) {
  if (!count) return null
  return (
    <p className={styles.band}>
      <strong>확정 안 된 날 {count}일</strong> — 기록은 있는데 일지를 확정하지 않은 날이에요
    </p>
  )
}

function MonthPeriods(props: {
  type: LogType
  month: string
  today: string
  weekStart: number
  onMonth: (m: string) => void
}) {
  const { type, month, today, weekStart } = props
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const last = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  const query = useLogPeriods(type, first, last)
  // 달 단위 띠는 일간 기준(주간 탭도 같은 달의 미확정 일)
  const daily = useLogPeriods('DAILY', first, last)
  const shiftMonth = (by: number) => props.onMonth(addMonths(first, by).slice(0, 7))
  return (
    <>
      <Stepper label={`${y}년 ${m}월`} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} />
      <UnconfirmedBand count={daily.data?.unconfirmedDays} />
      {query.isPending ? (
        <Skeleton shape="block" height={360} offlineText="연결되면 일지를 불러올게요" />
      ) : query.isError ? (
        <div className={styles.failed}>
          <p>일지 목록을 불러오지 못했어요.</p>
          <button type="button" className={styles.secondary} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </div>
      ) : type === 'DAILY' ? (
        <DayGrid items={query.data.items} first={first} today={today} weekStart={weekStart} />
      ) : (
        <PeriodRows items={query.data.items} today={today} />
      )}
    </>
  )
}

function DayGrid({
  items,
  first,
  today,
  weekStart,
}: {
  items: LogPeriod[]
  first: string
  today: string
  weekStart: number
}) {
  const { open, opening } = useOpenPeriod()
  const lead = (isoWeekday(first) - weekStart + 7) % 7
  const heads = Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(weekStart - 1 + i) % 7])
  return (
    <div className={styles.calendar}>
      <div className={styles.weekHead} aria-hidden="true">
        {heads.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <ul className={styles.days} aria-label="날짜별 일지">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden="true" />
        ))}
        {items.map((p) => {
          const off = p.workday === false
          const future = p.periodStart > today
          // 앞으로 올 날·쉬는 날의 "기록 없음"은 굳이 적지 않는다
          const label = (future || off) && p.status === 'NO_RECORDS' ? '' : STATUS_LABEL[p.status]
          const text = `${periodText('DAILY', p.periodStart, p.periodStart)}${p.holiday ? ` ${p.holiday}` : off ? ' 휴일' : ''}${label ? ` ${label}` : ''}`
          const cls = [
            styles.cell,
            off && styles.cellOff,
            p.periodStart === today && styles.cellToday,
            styles[`cell${p.status}`],
          ]
            .filter(Boolean)
            .join(' ')
          const body = (
            <>
              <span className={styles.dayNo}>{Number(p.periodStart.slice(8))}</span>
              {p.holiday && <span className={styles.holiday}>{p.holiday}</span>}
              {label && <span className={styles.cellStatus}>{label}</span>}
            </>
          )
          return (
            <li key={p.periodStart}>
              {p.status === 'NOT_WRITTEN' ? (
                <button
                  type="button"
                  className={cls}
                  aria-label={`${text} — 초안 만들기`}
                  aria-busy={opening === p.periodStart || undefined}
                  disabled={opening != null}
                  onClick={() => void open(p)}
                >
                  {body}
                </button>
              ) : (
                <Link to={logHref('DAILY', p.periodStart)} className={cls} aria-label={text}>
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PeriodRows({ items, today }: { items: LogPeriod[]; today: string }) {
  const { open, opening } = useOpenPeriod()
  return (
    <ul className={styles.rows}>
      {items.map((p) => {
        const future = p.periodStart > today
        return (
          <li key={p.periodStart}>
            <button
              type="button"
              className={styles.row}
              disabled={opening != null}
              aria-busy={opening === p.periodStart || undefined}
              onClick={() => void open(p)}
            >
              <span className={styles.rowTitle}>{periodText(p.type, p.periodStart, p.periodEnd)}</span>
              {!(future && p.status === 'NO_RECORDS') && (
                <span className={`${styles.badge} ${styles[`badge${p.status}`]}`}>{STATUS_LABEL[p.status]}</span>
              )}
              {p.days && (
                <span className={styles.muted}>
                  확정 {p.days.confirmed}/{p.days.workdays}일
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function YearRows({ year, today, onYear }: { year: string; today: string; onYear: (y: string) => void }) {
  const query = useLogPeriods('MONTHLY', `${year}-01-01`, `${year}-12-31`)
  return (
    <>
      <Stepper
        label={`${year}년`}
        onPrev={() => onYear(String(Number(year) - 1))}
        onNext={() => onYear(String(Number(year) + 1))}
      />
      {query.isPending ? (
        <Skeleton count={6} offlineText="연결되면 일지를 불러올게요" />
      ) : query.isError ? (
        <div className={styles.failed}>
          <p>일지 목록을 불러오지 못했어요.</p>
          <button type="button" className={styles.secondary} onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </div>
      ) : (
        <PeriodRows items={query.data.items} today={today} />
      )}
    </>
  )
}

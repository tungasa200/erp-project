// 차트에 넣을 값 만들기 (SCR-STAT-01 ③④⑥). 컴포넌트 파일과 나눠 둔다(fast refresh).
// 계약은 하루 단위(daily)로 주고, 주·달 묶기는 화면이 프로필 주 시작 요일로 한다(worklog.yaml 0.6.0 GET /stats).
import { addDays, diffDays, startOfWeek, type Weekday } from '../calendar/time'
import type { Project } from '../projects/api'
import type { Stats } from './api'
import { MAX_PERIOD_DAYS, rangeLabel, shortDay } from './period'

/** 주가 이만큼보다 많으면(직접 선택으로 긴 기간) 달 단위로 묶어 막대가 너무 가늘어지지 않게 한다 */
export const MAX_WEEK_BARS = 12

/** 첫 확정 기록에서 이만큼 지나야 통계를 보인다(데이터 부족: "1주일 기록이 쌓이면 보여 드려요") */
export const READY_DAYS = 7

export interface Bucket {
  key: string
  /** 막대 아래 짧은 이름 (9/1, 9월) */
  label: string
  /** 표·읽기용 긴 이름 (9/1–9/7, 2026년 9월) */
  long: string
  value: number
}

/** 완료 업무 막대. 주(기간 안쪽 날짜만)로 묶고, 주가 많으면 달로 묶는다 */
export function completedBuckets(daily: Stats['daily'], weekStart: Weekday, today: string): Bucket[] {
  const weeks = new Map<string, { first: string; last: string; value: number }>()
  for (const d of daily) {
    const key = startOfWeek(d.date, weekStart)
    const week = weeks.get(key) ?? { first: d.date, last: d.date, value: 0 }
    week.last = d.date
    week.value += d.completedTaskCount
    weeks.set(key, week)
  }
  if (weeks.size <= MAX_WEEK_BARS) {
    return [...weeks.values()].map((w) => ({
      key: w.first,
      label: shortDay(w.first, today),
      long: rangeLabel(w.first, w.last, today),
      value: w.value,
    }))
  }
  const months = new Map<string, Bucket>()
  for (const d of daily) {
    const ym = d.date.slice(0, 7)
    const [y, m] = ym.split('-').map(Number)
    const bucket = months.get(ym) ?? {
      key: ym,
      label: ym.slice(0, 4) === today.slice(0, 4) ? `${m}월` : `${String(y).slice(2)}.${m}`,
      long: `${y}년 ${m}월`,
      value: 0,
    }
    bucket.value += d.completedTaskCount
    months.set(ym, bucket)
  }
  return [...months.values()]
}

/** 데이터 부족 판단: 첫 확정 기록이 없거나 READY_DAYS일이 안 됐으면 남은 날 수(없으면 null) */
export function readiness(firstRecordDate: string | null, today: string): { ready: boolean; daysLeft: number | null } {
  if (!firstRecordDate) return { ready: false, daysLeft: null }
  const passed = diffDays(firstRecordDate, today)
  return passed >= READY_DAYS ? { ready: true, daysLeft: 0 } : { ready: false, daysLeft: READY_DAYS - passed }
}

/**
 * 예상 대비 실제는 주 단위로 맞춰 부른다(계약: 화면은 주 단위로 맞춰 보낸다). 기간 첫날의 주 시작일 ~ 끝날 주의 마지막 날.
 * 맞춘 기간이 400일을 넘으면(직접 선택 400일 근처) 고른 기간 그대로 보낸다.
 */
export function weekAligned(from: string, to: string, weekStart: Weekday): { from: string; to: string } {
  const start = startOfWeek(from, weekStart)
  const end = addDays(startOfWeek(to, weekStart), 6)
  return diffDays(start, end) + 1 > MAX_PERIOD_DAYS ? { from, to } : { from: start, to: end }
}

export const NO_PROJECT = '프로젝트 없음'

export function projectName(projects: Project[], id: string | null): string {
  return id ? (projects.find((p) => p.id === id)?.name ?? '알 수 없는 프로젝트') : NO_PROJECT
}

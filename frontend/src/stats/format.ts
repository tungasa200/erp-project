// 통계 숫자 표시. 시간은 목업처럼 "31시간", "33.5시간"(0.5시간 단위 반올림), 1시간 미만은 "45분".
const MINUS = '−'

export function hoursText(min: number): string {
  const abs = Math.abs(min)
  if (abs < 60) return `${abs}분`
  const h = Math.round(abs / 30) / 2
  return `${Number.isInteger(h) ? h : h.toFixed(1)}시간`
}

/** 실제 - 예상. "+3시간", "−1.5시간", 같으면 "0" */
export function diffText(planned: number, actual: number): string {
  const d = actual - planned
  if (d === 0) return '0'
  return `${d > 0 ? '+' : MINUS}${hoursText(d)}`
}

export type DiffTone = 'over' | 'under' | 'even'

export function diffTone(planned: number, actual: number): DiffTone {
  return actual > planned ? 'over' : actual < planned ? 'under' : 'even'
}

/** 1,234 */
export const count = (n: number) => n.toLocaleString('ko-KR')

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

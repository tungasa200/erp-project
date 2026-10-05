// 공휴일 (D-25, D-37). 원본은 저장소 루트 shared/holidays/KR.json으로 worklog와 함께 쓴다.
import data from '../../../shared/holidays/KR.json'

const byDate: Record<string, string> = Object.assign(
  {},
  ...Object.values(data as Record<string, Record<string, string>>),
)

/** 공휴일 이름, 아니면 undefined */
export function holidayName(date: string): string | undefined {
  return byDate[date]
}

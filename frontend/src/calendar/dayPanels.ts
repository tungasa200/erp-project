// 일 보기 패널(업무·이날의 기록)을 접었는지 이 기기에 기억한다(X-07 D, 사용자 결정 카드 1701 Q7 ①).
// 화면 폭마다 원하는 값이 달라 계정 설정이 아니라 localStorage에 둔다. 업무 패널은 기본 접힘, 기록 패널은 기본 펼침.
import { useState } from 'react'

const KEY = 'wy.calendar.dayPanels'

export interface DayPanels {
  tasks: boolean
  records: boolean
}

const DEFAULTS: DayPanels = { tasks: false, records: true }

function load(): DayPanels {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DayPanels>) }
  } catch {
    return DEFAULTS
  }
}

/** 한 패널의 펼침 상태와 바꾸는 함수. 바꾸면 바로 기억한다 */
export function useDayPanel(name: keyof DayPanels): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => load()[name])
  const set = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), [name]: next }))
    } catch {
      // 저장소가 막혀 있으면(사생활 모드 등) 이번 화면에서만 기억한다
    }
  }
  return [open, set]
}

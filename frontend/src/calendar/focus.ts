import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { occurrenceKey, type Occurrence } from './api'

/** 다시 그려져도 같은 일정을 가리키는 값. 반복 회차 키는 옮겨도 그대로이고, 반복 없는 일정은 일정 id로 찾는다 */
export function occurrenceFocusId(o: Occurrence) {
  return o.recurring ? occurrenceKey(o) : o.scheduleId
}

/**
 * 같은 일정 묶음의 같은 날짜. 반복 일정 전체의 시각을 바꾸면 회차 키가 모두 바뀌므로(범위 "모든 일정"), 같은 날짜의
 * 같은 일정으로 찾는다. 지운 회차는 그날 같은 일정이 남지 않아 제목으로 간다
 */
export function focusGroup(o: Occurrence, date: string) {
  return `${o.scheduleId}@${date}`
}

export { markFocus, restoreFocus, useFocusRescue, type FocusMark } from '../components/focusRescue'

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** 팝오버 안에서 Tab·Shift+Tab을 돌린다. 열린 팝오버 밖으로 포커스가 새지 않게(UX-CAL-141, WCAG 2.4.3) */
export function cycleTab(e: KeyboardEvent | ReactKeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || e.defaultPrevented || !container) return
  const items = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !el.closest('[hidden], [inert]'),
  )
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1
  e.preventDefault()
  items[next].focus()
}

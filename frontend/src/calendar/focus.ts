import { useEffect, type RefObject } from 'react'
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

/** 포커스 자리 기록. 요소가 사라져도 같은 일정([data-focus-id])·목록([data-focus-list]) 안 같은 자리로 찾아갈 수 있게 남긴다 */
export interface FocusMark {
  target: HTMLElement | null
  id?: string
  group?: string
  list: HTMLElement | null
  index: number
}

const listItems = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLElement>('[data-focus-item]'))

export function markFocus(target = document.activeElement as HTMLElement | null): FocusMark {
  const list = target?.matches('[data-focus-item]') ? target.closest<HTMLElement>('[data-focus-list]') : null
  const data = target?.dataset
  return {
    target,
    id: data?.focusId,
    group: data?.focusGroup,
    list,
    index: list ? listItems(list).indexOf(target!) : -1,
  }
}

/**
 * 기록한 자리로 포커스를 돌린다(P1-07-18). 그 요소가 사라졌으면 다시 그려진 같은 일정 → 같은 날짜의 같은 일정 묶음
 * → 같은 목록의 같은 자리 이웃 → 캘린더 제목([data-focus-fallback]) 순으로 찾는다. 일 보기의 제목은 그날 날짜다
 */
export function restoreFocus(mark: FocusMark | null) {
  const { target, id, group, list, index } = mark ?? { target: null, list: null, index: -1 }
  const find = (attr: 'focusId' | 'focusGroup', value: string | undefined) =>
    value
      ? Array.from(document.querySelectorAll<HTMLElement>('[data-focus-id]')).find((e) => e.dataset[attr] === value)
      : undefined
  const neighbors = list?.isConnected ? listItems(list) : []
  const candidates = [
    target?.isConnected && target !== document.body ? target : undefined,
    find('focusId', id),
    find('focusGroup', group),
    neighbors[Math.min(index, neighbors.length - 1)],
    document.querySelector<HTMLElement>('[data-focus-fallback]') ?? undefined,
  ]
  for (const el of candidates) {
    el?.focus()
    if (el && document.activeElement === el) return
  }
}

/**
 * 포커스가 있던 요소가 사라져 body로 빠지면 restoreFocus로 되살린다. 일정 삭제·업무 배치·보기 전환처럼
 * 대화상자가 원래 자리로 포커스를 돌린 뒤에 그 자리가 사라지는 경우를 한곳에서 막는다
 */
export function useFocusRescue(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    let last: FocusMark | null = null
    const onFocusIn = (e: FocusEvent) => {
      last = markFocus(e.target as HTMLElement)
    }
    // 빈 곳을 눌러 스스로 포커스를 놓은 경우(요소는 그대로 있음)는 되살리지 않는다
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return
      queueMicrotask(() => {
        if (last?.target?.isConnected) last = null
      })
    }
    const observer = new MutationObserver(() => {
      if (!last || last.target?.isConnected) return
      const active = document.activeElement
      if (active && active !== document.body) return
      const mark = last
      last = null
      restoreFocus(mark)
    })
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    observer.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
      observer.disconnect()
    }
  }, [root])
}

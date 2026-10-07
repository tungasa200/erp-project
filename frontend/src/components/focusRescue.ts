// 포커스 유실 안전망(P1-07-18). 캘린더에서 시작해 앱 셸 본문 전체에 건다: 화면별 포커스 처리가 놓친 경우의 마지막 자리.
// 목록 항목은 [data-focus-list] 안 [data-focus-item], 다시 그려져도 같은 대상은 [data-focus-id]·[data-focus-group]으로 찾는다.
import { useEffect, type RefObject } from 'react'
import { focusPageHeading } from './focusFallback'

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
 * → 같은 목록의 같은 자리 이웃 → 화면이 정한 대체 목적지([data-focus-fallback], 캘린더는 제목이고 일 보기는
 * 그날 날짜) → 화면 제목(h1) 순으로 찾는다
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
  focusPageHeading()
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

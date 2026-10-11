// 캘린더 터치 규칙(SCR-CAL 공통). 손가락만 해당하고 마우스·펜은 지금처럼 바로 끈다.
// 바로 움직이면 스크롤(브라우저 기본), 짧게 누르면 누르기, 약 450ms 길게 누른 뒤에야 끌기(만들기·옮기기·늘리기)가 시작된다.
import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'

export const HOLD_MS = 450
/** 길게 누르는 동안 이만큼 움직이면 스크롤로 보고 기다림을 버린다 */
export const HOLD_SLOP = 10

interface Pending {
  pointerId: number
  x: number
  y: number
  timer: number
  onTap: () => void
}

export function useTouchHold(ref: RefObject<HTMLElement | null>) {
  const pending = useRef<Pending | null>(null)
  const holding = useRef(false)

  const clear = () => {
    if (pending.current) window.clearTimeout(pending.current.timer)
    pending.current = null
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // touch-action은 누르는 순간 정해져 바꿀 수 없다. 길게 누름이 인식된 뒤에만 이 손가락의 스크롤을 touchmove에서 막는다
    const blockScroll = (e: TouchEvent) => {
      if (holding.current && e.cancelable) e.preventDefault()
    }
    // 길게 누르면 뜨는 메뉴(안드로이드)도 끈다
    const blockMenu = (e: Event) => {
      if (pending.current || holding.current) e.preventDefault()
    }
    el.addEventListener('touchmove', blockScroll, { passive: false })
    el.addEventListener('contextmenu', blockMenu)
    return () => {
      el.removeEventListener('touchmove', blockScroll)
      el.removeEventListener('contextmenu', blockMenu)
      clear()
    }
  }, [ref])

  return {
    /** 터치면 기다림을 시작하고 true(호출한 쪽은 바로 끌기를 시작하지 않는다). 마우스·펜이면 false */
    start(e: PointerEvent, onHold: () => void, onTap: () => void): boolean {
      if (e.pointerType !== 'touch') return false
      clear()
      holding.current = false
      const timer = window.setTimeout(() => {
        pending.current = null
        holding.current = true
        navigator.vibrate?.(10)
        onHold()
      }, HOLD_MS)
      pending.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer, onTap }
      return true
    },
    /** 기다리는 중이면 true(끌기 처리를 건너뛴다). 많이 움직이면 기다림을 버리고 스크롤에 맡긴다 */
    move(e: PointerEvent): boolean {
      const p = pending.current
      if (!p || p.pointerId !== e.pointerId) return false
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= HOLD_SLOP) clear()
      return true
    },
    /** 뗐을 때 아직 기다리는 중이었으면 짧게 누르기로 처리하고 true */
    end(e: PointerEvent): boolean {
      holding.current = false
      const p = pending.current
      if (!p || p.pointerId !== e.pointerId) return false
      clear()
      p.onTap()
      return true
    },
    cancel() {
      clear()
      holding.current = false
    },
  }
}

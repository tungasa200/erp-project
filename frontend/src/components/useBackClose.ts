// COM-02 뒤로 가기로 시트·전체 화면 패널 닫기(D-223, docs/ux/모바일규칙_안_v1.md ①)
// 창을 열면 기록을 하나 쌓고, 뒤로 가기는 맨 위 창 하나만 닫는다. 창 안의 [×]·Esc로 닫으면 쌓은 기록을 하나 되돌린다.
// 작은 팝오버에는 쓰지 않는다. 입력한 내용은 창을 닫는 쪽(onClose)이 지금처럼 다룬다.
//
// 쓰는 법: useBackClose(open, onClose) — open이 true인 동안 기록 하나를 차지한다.
import { useEffect, useRef } from 'react'

type Entry = { id: number; close: () => void }

const KEY = 'wyOverlay'
const stack: Entry[] = []
let seq = 0
let swallow = 0
let listening = false
let leaving: number | undefined

function markerOf(state: unknown): number | undefined {
  const value = (state as Record<string, unknown> | null)?.[KEY]
  return typeof value === 'number' ? value : undefined
}

// 라우터보다 먼저(캡처 단계) 받아서, 창 기록이 오갈 때는 라우터에 POP이 가지 않게 막는다.
// 창 기록은 아래 라우터 기록과 주소·idx가 같아 라우터가 알 필요가 없다(알면 useBlocker가 이탈 확인을 띄움).
function onPopState(event: PopStateEvent) {
  leaving = undefined
  if (swallow > 0) {
    swallow--
    event.stopImmediatePropagation()
    return
  }
  const current = markerOf(event.state) ?? 0
  const closing = stack.filter((entry) => entry.id > current)
  if (closing.length > 0) {
    event.stopImmediatePropagation()
    for (const entry of closing.reverse()) {
      stack.splice(stack.indexOf(entry), 1)
      entry.close()
    }
    return
  }
  // 닫힌 창이 남긴 기록(창 안 링크로 이동한 뒤 등)으로 돌아오면 한 칸 더 건너뛴다
  if (markerOf(event.state) !== undefined && !stack.some((entry) => entry.id === current)) {
    event.stopImmediatePropagation()
    history.back()
  }
}

export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    if (!listening) {
      window.addEventListener('popstate', onPopState, true)
      listening = true
    }
    const id = ++seq
    const entry: Entry = { id, close: () => closeRef.current() }
    // 막 닫힌 창의 기록(되돌리기 전)이 맨 위에 있으면 새로 쌓지 않고 그 자리를 쓴다(빠른 기록 → 확인 대기처럼 창을 바꿔 열 때)
    const top = markerOf(history.state)
    const stale = top !== undefined && !stack.some((e) => e.id === top)
    const state = { ...(history.state as object | null), [KEY]: id }
    if (stale) history.replaceState(state, '')
    else history.pushState(state, '')
    stack.push(entry)
    return () => {
      const index = stack.indexOf(entry)
      if (index < 0) return // 뒤로 가기로 이미 닫힘
      stack.splice(index, 1)
      // 다음 차례에 확인한다. 창 안 링크로 이동했으면 맨 위 기록이 이미 바뀌어 있어 되돌리지 않는다
      setTimeout(() => {
        if (markerOf(history.state) === id) {
          swallow++
          history.back()
        }
      })
    }
  }, [open])
}

// 창 안 버튼([완료]·Esc·바깥)으로 닫을 때도 뒤로 가기처럼 창 기록을 먼저 걷고, 닫기(onClose)는 popstate에서 부른다.
// 닫으면서 주소를 바꾸는 창이 쓴다: 창 기록 위에서 주소를 바꾸면 그 기록이 남아 다음 뒤로 가기가 화면을 떠나지 못한다.
// 맨 위 창의 기록이 지금 기록이 아니면 false(부른 쪽이 바로 닫는다)
export function closeByBack(): boolean {
  const top = markerOf(history.state)
  if (top === undefined || stack[stack.length - 1]?.id !== top) return false
  // 두 번 눌러도 한 번만 되돌린다(두 번째 back은 화면을 떠난다)
  if (leaving !== top) {
    leaving = top
    history.back()
  }
  return true
}

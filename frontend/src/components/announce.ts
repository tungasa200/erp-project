// 앱 전체 낭독 영역(LiveRegion)에 글을 넣는 통로(UX-COM-25·13)
type Listener = (message: string) => void

const listeners = new Set<Listener>()
// 영역이 붙기 전에 온 글(같은 틱에 먼저 그려진 오프라인 띠 등)은 붙는 대로 읽는다
let waiting: string | null = null

/** 낭독기에 한 번 읽힌다(polite). 같은 글을 다시 넣어도 다시 읽힌다 */
export function announce(message: string) {
  if (listeners.size === 0) waiting = message
  listeners.forEach((listener) => listener(message))
}

/** LiveRegion만 쓴다. 기다리던 글이 있으면 바로 넘긴다 */
export function subscribeAnnounce(listener: Listener) {
  listeners.add(listener)
  if (waiting !== null) {
    listener(waiting)
    waiting = null
  }
  return () => {
    listeners.delete(listener)
  }
}

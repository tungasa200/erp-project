// 남은 초를 1초마다 다시 계산한다. 목표 시각이 없으면 null.
import { useEffect, useState } from 'react'

const secondsUntil = (target: Date | null) =>
  target === null ? null : Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000))

export function useCountdown(target: Date | null): number | null {
  const [seconds, setSeconds] = useState(() => secondsUntil(target))
  const [prevTarget, setPrevTarget] = useState(target)
  if (prevTarget !== target) {
    setPrevTarget(target)
    setSeconds(secondsUntil(target))
  }

  useEffect(() => {
    if (target === null) return
    const timer = setInterval(() => {
      const left = secondsUntil(target)
      setSeconds(left)
      if (left === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [target])

  return seconds
}

/** 07:12 */
export function mmss(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

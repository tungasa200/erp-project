// 남은 초를 1초마다 다시 계산한다. 목표 시각이 없으면 null.
// 목표 시각은 서버 시각 기준이라 이 기기 시계가 늦으면 남은 시간이 실제보다 길게 나온다. max를 주면 그 이상은 보이지 않는다
// (예: 10:09 → 10:00). 시계가 빠른 경우는 서버가 429·만료로 알려 준다 (P1-X 운영 확인)
import { useEffect, useState } from 'react'

const secondsUntil = (target: Date | null, max: number) =>
  target === null ? null : Math.min(max, Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000)))

export function useCountdown(target: Date | null, max = Infinity): number | null {
  const [seconds, setSeconds] = useState(() => secondsUntil(target, max))
  const [prevTarget, setPrevTarget] = useState(target)
  if (prevTarget !== target) {
    setPrevTarget(target)
    setSeconds(secondsUntil(target, max))
  }

  useEffect(() => {
    if (target === null) return
    const timer = setInterval(() => {
      const left = secondsUntil(target, max)
      setSeconds(left)
      if (left === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [target, max])

  return seconds
}

/** 07:12 */
export function mmss(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

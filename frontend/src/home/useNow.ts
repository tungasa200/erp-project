import { useEffect, useState } from 'react'

/** 1분마다 바뀌는 현재 시각 (남은 일정 수·날짜 넘김, 홈 머리 날짜·인사말 UX-HOME-09) */
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

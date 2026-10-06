// 로딩 표시를 늦게 켜는 훅 (화면정의서 2장: 0.3초 안에 끝나면 표시하지 않음). Skeleton이 쓰고, 직접 모양을 그릴 때도 쓴다.
import { useEffect, useState } from 'react'

export const SKELETON_DELAY_MS = 300

/** 그린 뒤 delay가 지나면 true. 그 전에 사라지면(로딩이 끝나면) 아무것도 보이지 않는다 */
export function useDelayed(delay = SKELETON_DELAY_MS): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(timer)
  }, [delay])
  return shown
}

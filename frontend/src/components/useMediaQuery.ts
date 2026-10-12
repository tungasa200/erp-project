import { useSyncExternalStore } from 'react'

/** 화면 조건(media query)이 맞는지. 창 크기가 바뀌면 다시 그린다. matchMedia가 없으면(jsdom) false */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? false,
  )
}

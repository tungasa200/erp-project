// UX-09 키보드 단축키. 한글 입력 상태에서도 동작하도록 입력된 문자(key)가 아니라 물리 키(code)로 판별한다.
// 수식키 없는 한 글자 단축키는 입력창에 포커스가 있으면 동작하지 않고, 사용자 설정으로 끌 수 있다(WCAG 2.1 SC 2.1.4).
import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/useAuth'

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  )
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Ctrl+K · ⌘K처럼 화면에 보여 줄 수식키 단축키 이름 */
export function modKey(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

export function useShortcutsEnabled(): boolean {
  const { user } = useAuth()
  return user?.keyboardShortcutsEnabled !== false
}

/** 수식키 없는 한 글자 단축키. 키는 KeyboardEvent.code(예: 'KeyN') */
export function useSingleKeyShortcuts(map: Record<string, () => void>) {
  const enabled = useShortcutsEnabled()
  const mapRef = useRef(map)
  useEffect(() => {
    mapRef.current = map
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (isEditable(e.target)) return
      // 모달이 열려 있으면 뒤 화면의 단축키를 막는다.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const action = Object.hasOwn(mapRef.current, e.code) ? mapRef.current[e.code] : undefined
      if (!action) return
      e.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

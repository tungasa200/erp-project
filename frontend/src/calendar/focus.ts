/** 연 요소로 포커스를 돌린다. 그 요소가 사라졌으면(삭제한 일정 등) 캘린더 제목([data-focus-fallback])으로 */
export function restoreFocus(previous: HTMLElement | null) {
  if (previous?.isConnected && previous !== document.body) previous.focus()
  else document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus()
}

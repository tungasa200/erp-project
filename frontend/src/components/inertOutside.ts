/** 창의 조상 사슬만 남기고 그 형제를 inert로. 알림 영역(aria-live)은 창이 열려도 읽혀야 해서 남긴다. 되돌릴 함수를 돌려준다
 *  (calendar/Modal.tsx의 같은 함수와 동작이 같다. 하나로 합치는 것은 그 파일 담당 WY-frontend2와 맞춘 뒤) */
export function inertOutside(dialog: HTMLElement) {
  const changed: HTMLElement[] = []
  for (let node: HTMLElement | null = dialog; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute('inert')) continue
      if (sibling.matches('[aria-live], script, style')) continue
      sibling.setAttribute('inert', '')
      changed.push(sibling)
    }
  }
  return () => changed.forEach((el) => el.removeAttribute('inert'))
}

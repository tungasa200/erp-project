// 누른 요소가 사라지는데 포커스를 둘 이웃이 없을 때(토스트·배너 닫기 등) 화면 제목(h1)으로 옮긴다.
// 그대로 두면 포커스가 BODY로 빠져 키보드·화면 낭독기 사용자가 위치를 잃는다.
export function focusPageHeading() {
  const heading = document.querySelector<HTMLElement>('h1')
  if (!heading) return
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
  heading.focus()
}

/** 누른 요소가 속한 section의 제목으로(다시 시도·안내 버튼처럼 성공하면 사라지는 버튼). 제목이 없으면 화면 제목으로 */
export function focusSectionHeading(from: Element) {
  const heading = from.closest('section')?.querySelector<HTMLElement>('h1, h2')
  if (!heading) return focusPageHeading()
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
  heading.focus()
}

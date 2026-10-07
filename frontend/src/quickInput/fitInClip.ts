// 절대 위치로 띄운 메뉴·팝오버를 잘리지 않는 자리로 옮긴다(P1-09-12 좁은 패널 칩 메뉴).
// 화면(좌우 16px 여백)뿐 아니라 overflow로 자르는 조상(캘린더 할 일 상자 같은 좁은 스크롤 패널) 안에 들어오게
// 가로로만 밀고, 그 폭보다 넓으면 폭을 줄인다. 열 때 한 번 부른다(useLayoutEffect).
export function fitInClip(el: HTMLElement, margin = 8) {
  el.style.translate = ''
  el.style.maxWidth = ''
  el.style.minWidth = ''
  // 폭을 줄이면 키가 커져 조상에 세로 스크롤바가 생길 수 있어, 줄인 뒤 한 번 더 잰다
  let bounds = clipBounds(el, margin)
  for (let pass = 0; pass < 2 && bounds.right - bounds.left < el.offsetWidth; pass++) {
    el.style.minWidth = '0'
    el.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`
    bounds = clipBounds(el, margin)
  }
  const rect = el.getBoundingClientRect()
  let shift = 0
  if (rect.right > bounds.right) shift = bounds.right - rect.right
  if (rect.left + shift < bounds.left) shift = bounds.left - rect.left
  if (shift) el.style.translate = `${Math.round(shift)}px 0`
}

function clipBounds(el: HTMLElement, margin: number) {
  let left = 16
  let right = window.innerWidth - 16
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === 'visible') continue
    // 세로 스크롤바 폭을 빼고 안쪽(client) 상자로 잰다
    const inner = p.getBoundingClientRect().left + p.clientLeft
    left = Math.max(left, inner + margin)
    right = Math.min(right, inner + p.clientWidth - margin)
  }
  return { left, right }
}

/** 열려 있는 동안 창 크기가 바뀌면(회전·패널 폭 변경) 다시 맞춘다. 정리 함수를 돌려준다 */
export function refitOnResize(el: HTMLElement) {
  const refit = () => fitInClip(el)
  window.addEventListener('resize', refit)
  return () => window.removeEventListener('resize', refit)
}

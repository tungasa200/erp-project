// 홈 본문 배치(홈PC 재디자인 사양 v2 ②a). 열 수는 화면 폭이 아니라 홈 본문 폭으로 정한다
// (1023→1024에서 사이드바가 넓어져 본문이 좁아지는 구간이 있어 미디어 쿼리로는 열 수가 뒤집힌다).
// CSS 컨테이너 쿼리를 쓰지 않는 까닭: container-type은 레이아웃 격리를 걸어 안쪽 position: fixed 창
// (확인 대기 패널, 빈 구간 채우기 창)의 기준이 화면이 아니라 본문이 된다.
import { useLayoutEffect, useRef, useState } from 'react'

export type HomeCols = 1 | 2 | 3

/** 기둥 칸 높이를 재는 격자 줄 높이(px). 칸마다 'span n'으로 제 높이만큼 줄을 차지해 옆 기둥 높이에 끌리지 않는다 */
const ROW = 4
const GAP = 16

export function colsFor(width: number): HomeCols {
  if (width >= 912) return 3
  if (width >= 600) return 2
  return 1
}

/**
 * root 폭으로 열 수(3·2·1)와 요약 타일 줄(넓음 4개 / 좁음 2×2)을 정하고,
 * board 안 [data-cell] 칸마다 높이만큼 격자 줄을 차지하게 한다(DOM·Tab 순서는 1열 순서 그대로).
 */
export function useHomeLayout() {
  const rootRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const root = rootRef.current
    const board = boardRef.current
    if (!root || !board || typeof ResizeObserver === 'undefined') return
    const cells = Array.from(board.querySelectorAll<HTMLElement>(':scope > [data-cell]'))
    const place = () => {
      for (const cell of cells) {
        const h = cell.getBoundingClientRect().height
        // 1열(칸이 display: contents)이면 높이가 0이라 줄을 차지하지 않는다
        cell.style.gridRowEnd = h > 0 ? `span ${Math.ceil((h + GAP) / ROW)}` : ''
      }
    }
    const observer = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target === root)) setWidth(root.clientWidth)
      place()
    })
    observer.observe(root)
    for (const cell of cells) observer.observe(cell)
    setWidth(root.clientWidth)
    place()
    return () => observer.disconnect()
  }, [])

  return { rootRef, boardRef, cols: colsFor(width), narrowTiles: width > 0 && width < 600 }
}

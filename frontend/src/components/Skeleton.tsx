// 로딩 스켈레톤 (화면정의서 2장: 로딩은 스켈레톤, 0.3초 안에 끝나면 표시하지 않음).
// 첫 로딩(query.isPending) 동안에만 그린다. 다시 불러오기(isFetching)에는 그리지 않고 지금 내용을 그대로 둔다.
// 그린 뒤 0.3초가 지나야 보이므로 빠른 응답에서는 깜박이지 않는다.
import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'
import { useDelayed } from './useDelayed'

/**
 * lines: 길이가 다른 여러 줄(목록·섹션) · line: 글자 자리 막대 하나(카드 숫자 등, 인라인)
 * chip: 알약 모양(태그·일정 칩) · card: 둥근 카드 · block: 높이를 정하는 사각형(캘린더 칸 등)
 */
export type SkeletonShape = 'lines' | 'line' | 'chip' | 'card' | 'block'

interface Props {
  shape?: SkeletonShape
  /** 몇 개 그릴지 (line은 무시) */
  count?: number
  /** block·card 높이(px) */
  height?: number
}

export function Skeleton({ shape = 'lines', count = 3, height }: Props) {
  const shown = useDelayed()
  if (!shown) return null
  const label = <span className={styles.srOnly}>불러오는 중</span>
  if (shape === 'line') {
    return (
      <span role="status" className={`${styles.bar} ${styles.line}`}>
        {label}
      </span>
    )
  }
  const size: CSSProperties | undefined = height ? { height } : undefined
  return (
    <div role="status" className={`${styles.group} ${styles[shape]}`}>
      {label}
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${styles.bar} ${styles[`${shape}Item`]}`} style={size} aria-hidden="true" />
      ))}
    </div>
  )
}

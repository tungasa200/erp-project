// 로딩 스켈레톤 (화면정의서 2장: 로딩은 스켈레톤, 0.3초 안에 끝나면 표시하지 않음).
// 첫 로딩(query.isPending) 동안에만 그린다. 다시 불러오기(isFetching)에는 그리지 않고 지금 내용을 그대로 둔다.
// 그린 뒤 0.3초가 지나야 보이므로 빠른 응답에서는 깜박이지 않는다.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import styles from './Skeleton.module.css'
import { useDelayed } from './useDelayed'
import { useOnline } from './useOnline'

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
  /** 끊긴 동안 대신 보일 안내. 기본 "연결되면 불러올게요" (예: "연결되면 업무를 불러올게요") */
  offlineText?: string
}

// 한 화면에 스켈레톤이 여럿이면 각자 role="status"라 "불러오는 중"을 겹쳐 알린다(UX-COM-25).
// 먼저 보인 하나만 status가 되고, 그것이 사라지면 다음 것이 넘겨받는다
const owners: object[] = []
const subscribers = new Set<() => void>()
const emit = () => subscribers.forEach((notify) => notify())
const subscribe = (notify: () => void) => {
  subscribers.add(notify)
  return () => subscribers.delete(notify)
}

function useStatusOwner(active: boolean) {
  const [me] = useState(() => ({}))
  useEffect(() => {
    if (!active) return
    owners.push(me)
    emit()
    return () => {
      owners.splice(owners.indexOf(me), 1)
      emit()
    }
  }, [active, me])
  return useSyncExternalStore(subscribe, () => owners[0] === me)
}

export function Skeleton({ shape = 'lines', count = 3, height, offlineText = '연결되면 불러올게요' }: Props) {
  const shown = useDelayed()
  const online = useOnline()
  const role = useStatusOwner(shown) ? 'status' : undefined
  if (!shown) return null
  // 끊긴 동안에는 조회가 멈춰(react-query paused) 첫 로딩이 끝나지 않는다. 막대만 돌리지 않고 이유를 알린다(P1-X-04).
  // 글자 자리(line)·칩은 자리가 좁아 그대로 두고, 화면 위 끊김 띠가 이유를 알린다
  if (!online && shape !== 'line' && shape !== 'chip') {
    return (
      <p role={role} className={styles.offline} data-skeleton>
        {offlineText}
      </p>
    )
  }
  const label = <span className="visually-hidden">불러오는 중</span>
  if (shape === 'line') {
    return (
      <span role={role} className={`${styles.bar} ${styles.line}`} data-skeleton>
        {label}
      </span>
    )
  }
  const size: CSSProperties | undefined = height ? { height } : undefined
  return (
    <div role={role} className={`${styles.group} ${styles[shape]}`} data-skeleton>
      {label}
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${styles.bar} ${styles[`${shape}Item`]}`} style={size} aria-hidden="true" />
      ))}
    </div>
  )
}

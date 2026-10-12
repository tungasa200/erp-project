// SCR-HOME-01 하루 마감 띠(디자인 규칙 v1.1 X-02 C, D-212 Q4, UX-HOME-04).
// 하루 마감 시각(SCR-SET-02 ⑤, 기본 18:00)이 지나면 머리 아래에 띠를 올린다. [하루 마감]이 이 화면의 유일한 채움이다.
// 닫기는 없다. 확정하면 "오늘 하루를 마감했어요" 한 줄로 바뀐다(업무일지 숨김 2026-10-12: [일지 보기] 없음). 비근무일은 그날 기록이 있을 때만(D-107).
import { formatMinutes, toZoned } from '../format/datetime'
import { useLog } from '../logs/api'
import { openDayClose } from '../logs/openDayClose'
import type { CloseBandState } from './closeBandState'
import styles from './home.module.css'

export function CloseBand({
  state,
  today,
  timeZone,
  pendingCount,
}: {
  state: CloseBandState
  today: string
  timeZone: string
  pendingCount: number
}) {
  const log = useLog('DAILY', today)
  if (!state) return null
  if (state === 'done') {
    const c = log.data?.content
    return (
      <section className={`${styles.closeBand} ${styles.closeBandDone}`} aria-label="하루 마감">
        <p className={styles.closeBandText}>
          <strong>
            <span className={styles.closeBandMark} aria-hidden="true">
              ✓{' '}
            </span>
            오늘 하루를 마감했어요
          </strong>
          <span className={styles.closeBandSub}>
            {log.data?.confirmedAt ? `${formatMinutes(toZoned(log.data.confirmedAt, timeZone).minutes)} 마감` : '마감'}
            {c ? ` · ${c.planTitle} ${c.plans.length}건` : ''}
          </span>
        </p>
      </section>
    )
  }
  return (
    <section className={styles.closeBand} aria-label="하루 마감" data-close-band="open">
      <p className={styles.closeBandText}>
        <strong>오늘 기록을 정리할 시간이에요</strong>
        {pendingCount > 0 && <span className={styles.closeBandSub}>확인 대기 {pendingCount}건</span>}
      </p>
      <button type="button" className={styles.closeBandButton} aria-haspopup="dialog" onClick={() => openDayClose()}>
        하루 마감
      </button>
    </section>
  )
}

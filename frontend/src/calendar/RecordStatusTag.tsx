// 기록 상태 표시(화면정의서 2.3): 했어요 · 확인 대기 · 안 했어요. 홈 타임라인과 같은 말을 쓴다.
import type { WorkRecord } from '../records/api'
import styles from './records.module.css'

const STATUS_LABEL: Record<WorkRecord['status'], string> = {
  CONFIRMED: '했어요',
  PENDING: '확인 대기',
  DISMISSED: '안 했어요',
}

export function RecordStatusTag({ record }: { record: WorkRecord }) {
  const className = {
    CONFIRMED: styles.tagDone,
    PENDING: styles.tagPending,
    DISMISSED: styles.tagSkipped,
  }[record.status]
  return (
    <span className={`${styles.tag} ${className}`}>
      {record.status === 'CONFIRMED' && <span aria-hidden="true">✓ </span>}
      {STATUS_LABEL[record.status]}
    </span>
  )
}

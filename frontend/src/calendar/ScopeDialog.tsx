// 반복 일정 범위 선택 (SCR-CAL-08). "이 일정 및 이후 일정"은 출시 후(D-24).
import { useId, useState } from 'react'
import type { Occurrence } from './api'
import { Modal } from './Modal'
import type { Scope, ScopeAction } from './useScheduleActions'
import styles from './calendar.module.css'

const TITLES: Record<ScopeAction, string> = {
  move: '반복 일정을 옮길까요?',
  edit: '반복 일정을 수정할까요?',
  editSeries: '반복 일정을 수정할까요?',
  delete: '반복 일정을 삭제할까요?',
}

interface Props {
  occurrence: Occurrence
  action: ScopeAction
  onClose: (scope: Scope | null) => void
}

export function ScopeDialog({ occurrence, action, onClose }: Props) {
  const id = useId()
  // 종일 여부·반복 규칙을 바꾸는 수정은 회차 하나로 할 수 없어 "모든 일정"만 고른다(계약 OccurrencePatch)
  const allowThis = action !== 'editSeries'
  const [scope, setScope] = useState<Scope>(allowThis ? 'this' : 'all')
  return (
    <Modal labelledBy={`${id}-title`} onClose={() => onClose(null)} narrow role="alertdialog">
      <h2 id={`${id}-title`} className={styles.title} style={{ fontSize: 18 }}>
        {TITLES[action]}
      </h2>
      <p className={styles.muted} style={{ fontSize: 14 }}>
        {occurrence.title}
      </p>
      <form
        className={styles.fieldset}
        onSubmit={(e) => {
          e.preventDefault()
          onClose(scope)
        }}
      >
        {allowThis && (
          <label className={styles.scopeOption}>
            <input type="radio" name="scope" checked={scope === 'this'} onChange={() => setScope('this')} />이 일정만
          </label>
        )}
        <label className={styles.scopeOption}>
          <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
          모든 일정
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => onClose(null)}>
            취소
          </button>
          <button type="submit" className={styles.primary}>
            확인
          </button>
        </div>
      </form>
    </Modal>
  )
}

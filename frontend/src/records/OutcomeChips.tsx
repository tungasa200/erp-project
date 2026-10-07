// 결과 칩 (REC-02): 완료 / 검토 요청 / 진행 중 n%. SCR-TASK-03(P2-02)과 같은 마크업·모양이다.
// 기록 추가·수정(SCR-REC-01)은 결과가 없는 기록도 있어 "없음"을 앞에 둔다.
// 진행률은 진행 중일 때만 보이고 10 단위(진행 중이라 0~90%).
import { useId } from 'react'
import type { WorkRecordOutcome } from './api'
import styles from './OutcomeChips.module.css'

const OUTCOMES: { value: WorkRecordOutcome; label: string }[] = [
  { value: 'DONE', label: '완료' },
  { value: 'REVIEW_REQUESTED', label: '검토 요청' },
  { value: 'IN_PROGRESS', label: '진행 중' },
]

interface Props {
  outcome: WorkRecordOutcome | null
  progress: number
  onChange: (outcome: WorkRecordOutcome | null, progress: number) => void
  allowNone?: boolean
  disabled?: boolean
}

export function OutcomeChips({ outcome, progress, onChange, allowNone, disabled }: Props) {
  const id = useId()
  const options = allowNone ? [{ value: null, label: '없음' }, ...OUTCOMES] : OUTCOMES
  return (
    <>
      <fieldset className={styles.chips} disabled={disabled}>
        <legend className={styles.srOnly}>결과</legend>
        {options.map((o) => (
          <label key={o.value ?? 'none'} className={styles.chip}>
            <input
              type="radio"
              name={`${id}-outcome`}
              value={o.value ?? ''}
              checked={outcome === o.value}
              onChange={() => onChange(o.value, progress)}
            />
            <span>{o.value === 'IN_PROGRESS' ? `${o.label} ${progress}%` : o.label}</span>
          </label>
        ))}
      </fieldset>
      {outcome === 'IN_PROGRESS' && (
        <label className={styles.progress}>
          <span>진행률</span>
          <input
            type="range"
            min={0}
            max={90}
            step={10}
            value={progress}
            disabled={disabled}
            aria-valuetext={`${progress}%`}
            onChange={(e) => onChange(outcome, Number(e.target.value))}
          />
        </label>
      )}
    </>
  )
}

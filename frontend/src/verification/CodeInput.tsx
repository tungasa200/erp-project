// 6자리 인증 코드 입력 (SCR-AUTH-05 ②, SCR-AUTH-08 ②). 실제 입력은 칸 하나라 붙여넣기·문자 자동완성·스크린리더가
// 그대로 동작하고, 보이는 6칸은 그 값을 나눠 그린 것이다. 6자리가 차면 onComplete를 부른다.
import { useId } from 'react'
import styles from './verification.module.css'

interface Props {
  value: string
  onChange: (value: string) => void
  onComplete: (code: string) => void
  label?: string
  disabled?: boolean
  status?: 'idle' | 'error' | 'ok'
  describedBy?: string
  autoFocus?: boolean
}

export const CODE_LENGTH = 6

export function CodeInput({
  value,
  onChange,
  onComplete,
  label = '인증번호',
  disabled = false,
  status = 'idle',
  describedBy,
  autoFocus,
}: Props) {
  const id = useId()
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '')
  const active = Math.min(value.length, CODE_LENGTH - 1)

  return (
    <div className={styles.codeField}>
      <label htmlFor={id} className={styles.srOnly}>
        {label}
      </label>
      <input
        id={id}
        className={styles.codeInput}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={status === 'error'}
        aria-describedby={describedBy}
        onChange={(e) => {
          // 붙여넣은 "123 456"이나 "123-456"도 숫자만 남긴다(maxLength를 두면 붙여넣기가 잘려 쓰지 않는다)
          const digits = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
          onChange(digits)
          if (digits.length === CODE_LENGTH && digits !== value) onComplete(digits)
        }}
      />
      <div className={styles.cells} aria-hidden="true">
        {cells.map((c, i) => (
          <span
            key={i}
            className={[styles.cell, styles[status], i === active && !disabled ? styles.cellActive : '']
              .filter(Boolean)
              .join(' ')}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

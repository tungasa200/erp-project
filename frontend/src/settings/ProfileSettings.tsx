// SCR-SET-01 설정 — 프로필. 이름·소속·직책은 칸을 벗어나거나 Enter를 누르면 저장한다.
import { useId, useState } from 'react'
import type { Me } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { isoWeekday, todayIn, WEEKDAY_NAMES } from '../quickInput/dates'
import { ConflictBanner, SaveError } from './parts'
import styles from './settings.module.css'
import { useProfileSaver, type ProfilePatch, type SaveResult } from './useProfileSaver'

type TextKey = 'name' | 'organization' | 'position'
type Save = (patch: ProfilePatch) => Promise<SaveResult>

const FIELDS: { key: TextKey; label: string; placeholder: string }[] = [
  { key: 'name', label: '이름', placeholder: '홍길동' },
  { key: 'organization', label: '소속', placeholder: '개발팀' },
  { key: 'position', label: '직책', placeholder: '매니저' },
]

export function ProfileSettings() {
  const { user } = useAuth()
  const { save, conflict, reload } = useProfileSaver()
  // 충돌 뒤 새로 불러오면 입력칸을 서버 값으로 다시 채운다(key로 다시 만든다).
  const [reloaded, setReloaded] = useState<{ me: Me; count: number } | null>(null)
  if (!user) return null

  return (
    <section aria-labelledby="settings-profile" className={styles.panel}>
      {conflict && (
        <ConflictBanner
          onReload={async () => {
            const me = await reload()
            if (me) setReloaded((prev) => ({ me, count: (prev?.count ?? 0) + 1 }))
          }}
        />
      )}
      <h2 id="settings-profile" className={styles.panelTitle}>
        프로필
      </h2>
      <p className={styles.lead}>업무일지 작성자 칸에 들어가는 정보예요. 바꾸면 이후 만드는 일지부터 반영돼요.</p>
      <ProfileForm key={reloaded?.count ?? 0} user={reloaded?.me ?? user} save={save} />
    </section>
  )
}

function ProfileForm({ user, save }: { user: Me; save: Save }) {
  const [values, setValues] = useState<Record<TextKey, string>>({
    name: user.name ?? '',
    organization: user.organization ?? '',
    position: user.position ?? '',
  })
  const today = todayIn(user.timezone)
  const [y, m, d] = today.split('-').map(Number)

  return (
    <>
      <div className={styles.grid}>
        {FIELDS.map((f) => (
          <TextField
            key={f.key}
            field={f.key}
            label={f.label}
            placeholder={f.placeholder}
            value={values[f.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            save={save}
          />
        ))}
      </div>
      <label className={styles.label}>
        이메일
        <input type="email" value={user.email} readOnly className={`${styles.input} ${styles.readOnly}`} />
      </label>

      <p className={styles.caption}>일지 머리 미리보기</p>
      <dl className={styles.header}>
        <dt>작성자</dt>
        <dd className={values.name.trim() ? undefined : styles.empty}>{values.name.trim() || '[이름]'}</dd>
        <dt>소속</dt>
        <dd className={values.organization.trim() ? undefined : styles.empty}>
          {values.organization.trim() || '[소속]'}
        </dd>
        <dt>직책</dt>
        <dd className={values.position.trim() ? undefined : styles.empty}>{values.position.trim() || '[직책]'}</dd>
        <dt>일자</dt>
        <dd>{`${y}. ${m}. ${d}.(${WEEKDAY_NAMES[isoWeekday(today) - 1]})`}</dd>
      </dl>
      <p className={styles.note}>자동 저장 · 이미 확정한 일지는 바뀌지 않아요</p>
    </>
  )
}

interface TextFieldProps {
  field: TextKey
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  save: Save
}

function TextField({ field, label, placeholder, value, onChange, save }: TextFieldProps) {
  const id = useId()
  const [saved, setSaved] = useState(value.trim())
  const [failure, setFailure] = useState<Extract<SaveResult, { ok: false }> | null>(null)

  const commit = async () => {
    const next = value.trim()
    if (next === saved) {
      if (failure?.reason !== 'conflict') setFailure(null)
      return
    }
    // 빈 칸은 값을 지운다(null)
    const result = await save({ [field]: next === '' ? null : next })
    if (result.ok) {
      setSaved(next)
      setFailure(null)
    } else {
      setFailure(result)
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className={styles.input}
        placeholder={placeholder}
        maxLength={100}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
        }}
        aria-invalid={failure !== null && failure.reason !== 'conflict'}
        aria-describedby={failure ? `${id}-error` : undefined}
      />
      <SaveError id={`${id}-error`} failure={failure} onRetry={() => void commit()} />
    </div>
  )
}

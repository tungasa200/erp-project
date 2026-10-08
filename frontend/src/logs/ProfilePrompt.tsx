// SCR-ONB-01 프로필 입력 요청 (P3, AUTH-04·UX-04). 이름·소속·직책 중 빈 칸이 있을 때 일지를 처음 만들 때만 묻는다.
// 진입: 고칠 수 있는 일지 화면 첫 진입, 하루 마감 확정 직전. [나중에]는 다음 일지에서 한 번 더 묻고, 그 뒤로는 설정에서만.
// 물을지는 profileAsk.ts가 정한다.
import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { worklogApi } from '../api'
import type { Me } from '../api/types'
import { Modal } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { useProfileSaver } from '../settings/useProfileSaver'
import { refreshLogs } from './api'
import { readPostponed, writePostponed } from './profileAsk'
import { periodText } from './format'
import styles from './logs.module.css'

type Key = 'name' | 'organization' | 'position'
const FIELDS: { key: Key; label: string; placeholder: string }[] = [
  { key: 'name', label: '이름', placeholder: '홍길동' },
  { key: 'organization', label: '소속', placeholder: '개발팀' },
  { key: 'position', label: '직책', placeholder: '매니저' },
]
interface Props {
  user: Me
  logKey: string
  today: string
  /** saved: 저장했으면 true, 나중에·닫기면 false */
  onDone: (saved: boolean) => void
}

export function ProfilePrompt({ user, logKey, today, onDone }: Props) {
  const id = useId()
  const queryClient = useQueryClient()
  const { save } = useProfileSaver()
  const [values, setValues] = useState<Record<Key, string>>({
    name: user.name ?? '',
    organization: user.organization ?? '',
    position: user.position ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const later = () => {
    const p = readPostponed(user.id)
    writePostponed(user.id, { count: p.count + 1, last: logKey })
    onDone(false)
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const patch = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key].trim() || null]))
    const result = await save(patch)
    if (!result.ok) {
      setBusy(false)
      setError(
        result.reason === 'conflict'
          ? '다른 곳에서 프로필을 먼저 고쳤어요. 설정에서 확인해 주세요'
          : result.reason === 'invalid'
            ? '입력한 값을 저장할 수 없어요. 길이를 줄여 주세요'
            : '저장하지 못했어요. 잠시 후 다시 시도해 주세요',
      )
      return
    }
    // 일지 머리는 worklog의 프로필 사본에서 오므로 사본을 먼저 맞추고 일지를 다시 받는다
    await worklogApi.refreshProfile().catch(() => {})
    void refreshLogs(queryClient)
    onDone(true)
  }

  const shown = (key: Key, label: string) =>
    values[key].trim() ? values[key].trim() : <span className={styles.profileBlank}>[{label}]</span>

  return (
    <Modal labelledBy={`${id}-t`} onClose={later} narrow>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id={`${id}-t`} className={styles.dialogTitle}>
          작성자 정보를 넣을까요?
        </h2>
        <p className={styles.dialogBody}>일지 머리에 들어갈 정보예요. 나중에 설정에서도 바꿀 수 있어요.</p>
        <div className={styles.profileFields}>
          {FIELDS.map((f) => (
            <label key={f.key} className={cal.field}>
              {f.label}
              <input
                className={cal.input}
                value={values[f.key]}
                placeholder={f.placeholder}
                maxLength={100}
                autoComplete={
                  f.key === 'name' ? 'name' : f.key === 'organization' ? 'organization' : 'organization-title'
                }
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <p className={styles.profileCaption} id={`${id}-p`}>
          일지 머리 미리보기
        </p>
        <dl className={styles.profilePreview} aria-labelledby={`${id}-p`}>
          <dt>일자</dt>
          <dd>{periodText('DAILY', today, today)}</dd>
          <dt>작성자</dt>
          <dd>{shown('name', '이름')}</dd>
          <dt>소속</dt>
          <dd>{shown('organization', '소속')}</dd>
          <dt>직책</dt>
          <dd>{shown('position', '직책')}</dd>
        </dl>
        {error && (
          <p role="alert" className={styles.profileError}>
            {error}
          </p>
        )}
        <div className={cal.actions}>
          <button type="button" className={cal.secondary} onClick={later}>
            나중에
          </button>
          <button type="submit" className={cal.primary} disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}

// SCR-SET-02 ⑤ 하루 마감 시각(UX-SET-140). 홈의 하루 마감 띠와 마감 알림이 이 시각을 따른다(D-212).
// 업무 시간대(WorkHoursSetting)와 같은 방식: worklog 설정이라 따로 저장하고, 칸을 떠날 때 저장하며, 오류는 이 항목에만 보인다.
import { useId, useRef, useState } from 'react'
import type { WorklogSettings } from '../api/types'
import { Skeleton } from '../components/Skeleton'
import { Row, SaveError } from './parts'
import styles from './settings.module.css'
import { useWorklogMe, type SettingsSaveResult, type useWorklogSettingsSaver } from './useWorklogSettings'

type Save = ReturnType<typeof useWorklogSettingsSaver>['save']
type Failure = Extract<SettingsSaveResult, { ok: false }>

const TITLE = '하루 마감 시각'
const DESCRIPTION = '이 시각부터 홈에 하루 마감 띠가 뜨고, 켜 두면 마감 알림도 이때 보내요'

/** reloadKey가 바뀌면(충돌 뒤 새로 불러오기) 서버 값으로 다시 채운다 */
export function DailyCloseSetting({ save, reloadKey }: { save: Save; reloadKey: number }) {
  const { data, isPending, isError, refetch } = useWorklogMe()
  if (data) return <DailyCloseForm key={reloadKey} settings={data.settings} save={save} />
  return (
    <Row title={TITLE} description={DESCRIPTION}>
      {isPending && <Skeleton count={1} />}
      {isError && (
        <p role="alert" className={styles.error}>
          불러오지 못했어요
          <button type="button" className={styles.retry} onClick={() => void refetch()}>
            다시 시도
          </button>
        </p>
      )}
    </Row>
  )
}

function DailyCloseForm({ settings, save }: { settings: WorklogSettings; save: Save }) {
  const id = useId()
  const [value, setValue] = useState(settings.dailyCloseTime)
  const saved = useRef(settings.dailyCloseTime)
  const sent = useRef(settings.dailyCloseTime)
  const [failure, setFailure] = useState<Failure | null>(null)

  const commit = async () => {
    // 덜 채운 칸('')은 저장하지 않고 마지막 저장값으로 되돌린다
    const next = value || saved.current
    setValue(next)
    if (next === sent.current && !failure) return
    sent.current = next
    const result = await save({ dailyCloseTime: next })
    setFailure(result.ok ? null : result)
    if (result.ok) {
      saved.current = result.settings.dailyCloseTime
      return
    }
    sent.current = saved.current
    if (result.reason === 'conflict') setValue(saved.current)
  }

  const errorId = `${id}-error`
  return (
    <>
      <Row title={<label htmlFor={`${id}-time`}>{TITLE}</label>} description={DESCRIPTION}>
        <input
          id={`${id}-time`}
          type="time"
          className={`${styles.select} ${styles.time}`}
          value={value}
          aria-invalid={failure !== null && failure.reason === 'invalid'}
          aria-describedby={errorId}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
        />
      </Row>
      <SaveError id={errorId} failure={failure} onRetry={() => void commit()} />
    </>
  )
}

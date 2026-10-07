// SCR-SET-02 ④ 업무 시간대(P2, TIME-11, 기본 09:00~18:00). worklog 설정이라 identity 항목과 따로 저장하고 오류도 이 항목에만 보인다.
// 시각 입력은 칸을 옮겨 다니며 고치므로 바꿀 때마다가 아니라 칸을 떠날 때 저장한다. 끝은 시작보다 늦어야 한다(자정 넘는 시간대 없음).
import { useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import type { WorklogSettings } from '../api/types'
import { Skeleton } from '../components/Skeleton'
import { Row, SaveError } from './parts'
import styles from './settings.module.css'
import { useWorklogMe, type SettingsSaveResult, type useWorklogSettingsSaver } from './useWorklogSettings'

type Save = ReturnType<typeof useWorklogSettingsSaver>['save']
type Failure = Extract<SettingsSaveResult, { ok: false }>

const ORDER_MESSAGE = '종료 시각은 시작 시각보다 늦어야 해요'
const DESCRIPTION = '빈 시간 메우기는 이 시간 안에서 빈 구간을 찾아요'

/** reloadKey가 바뀌면(충돌 뒤 새로 불러오기) 서버 값으로 다시 채운다 */
export function WorkHoursSetting({ save, reloadKey }: { save: Save; reloadKey: number }) {
  const { data, isPending, isError, refetch } = useWorklogMe()
  const id = useId()
  if (data) return <WorkHoursForm key={reloadKey} settings={data.settings} save={save} />
  return (
    <Row title={<span id={id}>업무 시간대</span>} description={DESCRIPTION}>
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

function WorkHoursForm({ settings, save }: { settings: WorklogSettings; save: Save }) {
  const id = useId()
  const titleId = `${id}-title`
  const queryClient = useQueryClient()
  const [start, setStart] = useState(settings.workHoursStart)
  const [end, setEnd] = useState(settings.workHoursEnd)
  // saved = 서버가 받아 준 값(충돌이면 여기로 되돌림), sent = 마지막으로 보낸 값(칸을 빠르게 오가도 같은 값을 두 번 보내지 않는다)
  const saved = useRef({ start: settings.workHoursStart, end: settings.workHoursEnd })
  const sent = useRef({ start: settings.workHoursStart, end: settings.workHoursEnd })
  const [orderError, setOrderError] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  const commit = async () => {
    // 비운 칸(브라우저 시각 입력은 덜 채우면 '')은 저장하지 않고 마지막 저장값으로 되돌린다
    const s = start || saved.current.start
    const e = end || saved.current.end
    setStart(s)
    setEnd(e)
    if (s >= e) {
      setOrderError(true)
      return
    }
    setOrderError(false)
    if (s === sent.current.start && e === sent.current.end && !failure) return
    sent.current = { start: s, end: e }
    const result = await save({ workHoursStart: s, workHoursEnd: e })
    setFailure(result.ok ? null : result)
    if (result.ok) {
      saved.current = { start: result.settings.workHoursStart, end: result.settings.workHoursEnd }
      // 빈 시간은 업무 시간대 안에서 계산한다
      void queryClient.invalidateQueries({ queryKey: ['records', 'gaps'] })
      return
    }
    sent.current = saved.current
    if (result.reason === 'conflict') {
      setStart(saved.current.start)
      setEnd(saved.current.end)
    }
  }

  const errorId = `${id}-error`
  const invalid = orderError || (failure !== null && failure.reason === 'invalid')
  const input = (label: string, value: string, set: (v: string) => void) => (
    <input
      type="time"
      aria-label={label}
      className={`${styles.select} ${styles.time}`}
      value={value}
      aria-invalid={invalid}
      aria-describedby={errorId}
      onChange={(e) => set(e.target.value)}
      onBlur={() => void commit()}
    />
  )

  return (
    <>
      <Row title={<span id={titleId}>업무 시간대</span>} description={DESCRIPTION}>
        <div role="group" aria-labelledby={titleId} className={styles.hours}>
          {input('업무 시작 시각', start, setStart)}
          <span aria-hidden="true">~</span>
          {input('업무 종료 시각', end, setEnd)}
        </div>
      </Row>
      {orderError ? (
        <p id={errorId} role="alert" className={styles.error}>
          {ORDER_MESSAGE}
        </p>
      ) : (
        <SaveError id={errorId} failure={failure} onRetry={() => void commit()} />
      )}
    </>
  )
}

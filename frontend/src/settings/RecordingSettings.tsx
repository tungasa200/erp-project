// SCR-SET-03 설정 — 기록 옵션 (P2-05, TIME-09). ① 시간 기록 토글(기본 꺼짐) ② 켜면 생기는 기능 ③ 꺼도 기록은 보존된다는 안내.
// 바꾸는 즉시 저장하고, 저장되면 useTimeTracking을 쓰는 화면 요소가 바로 나타나거나 숨는다.
import { useId, useState } from 'react'
import type { WorklogSettings } from '../api/types'
import { focusSectionHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { ConflictBanner, SaveError } from './parts'
import styles from './settings.module.css'
import { useWorklogMe, useWorklogSettingsSaver, type SettingsSaveResult } from './useWorklogSettings'

type Save = ReturnType<typeof useWorklogSettingsSaver>['save']
type Failure = Extract<SettingsSaveResult, { ok: false }>

const FEATURES = ['타이머', '계획/실제 타임라인', '빈 시간 메우기', '소요시간 집계']

export function RecordingSettings() {
  const { data, isPending, isError, refetch } = useWorklogMe()
  const { save, conflict, reload } = useWorklogSettingsSaver()
  // 충돌 뒤 새로 불러오면 스위치를 서버 값으로 다시 맞춘다(key로 다시 만든다)
  const [reloaded, setReloaded] = useState<{ settings: WorklogSettings; count: number } | null>(null)

  return (
    <section aria-labelledby="settings-recording" className={styles.panel}>
      {conflict && (
        <ConflictBanner
          onReload={async () => {
            const settings = await reload()
            if (settings) setReloaded((prev) => ({ settings, count: (prev?.count ?? 0) + 1 }))
          }}
        />
      )}
      <h2 id="settings-recording" className={styles.panelTitle}>
        기록 옵션
      </h2>
      {isPending && <Skeleton count={2} />}
      {isError && (
        <p role="alert" className={styles.error}>
          설정을 불러오지 못했어요
          <button
            type="button"
            className={styles.retry}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              void refetch()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {data && <RecordingForm key={reloaded?.count ?? 0} settings={reloaded?.settings ?? data.settings} save={save} />}
    </section>
  )
}

function RecordingForm({ settings, save }: { settings: WorklogSettings; save: Save }) {
  const id = useId()
  const [on, setOn] = useState(settings.timeTrackingEnabled)
  const [failure, setFailure] = useState<Failure | null>(null)
  const change = async (next: boolean) => {
    setOn(next)
    const result = await save({ timeTrackingEnabled: next })
    setFailure(result.ok ? null : result)
  }

  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <label htmlFor={`${id}-tt`} className={styles.rowTitle}>
            시간 기록
          </label>
          <div id={`${id}-tt-desc`} className={styles.rowDescription}>
            업무에 쓴 시간을 재고 계획과 비교해요
          </div>
        </div>
        <div className={styles.rowControl}>
          {/* 보이는 스위치는 56x32, 누르는 영역은 44px 높이 */}
          <button
            id={`${id}-tt`}
            type="button"
            role="switch"
            aria-checked={on}
            aria-describedby={`${id}-tt-desc ${id}-tt-error`}
            className={styles.switch}
            onClick={() => void change(!on)}
          >
            <span className={styles.track}>
              <span className={styles.knob} />
            </span>
          </button>
        </div>
      </div>
      <SaveError id={`${id}-tt-error`} failure={failure} onRetry={() => void change(on)} />

      <div className={styles.featureBox}>
        <p id={`${id}-features`} className={styles.featureTitle}>
          켜면 생기는 기능
        </p>
        <ul aria-labelledby={`${id}-features`} className={styles.features}>
          {FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <p className={styles.note}>꺼도 기존 시간 기록은 보존돼요. 화면에서만 숨겨요.</p>
    </>
  )
}

// SCR-SET-05 설정 — 알림 (P4-01, D-178 ②). ① 하루 마감 알림 스위치(기본 꺼짐, 바꾸는 즉시 저장) ② 알림 시각(일반 탭의 하루 마감 시각)
// ③ 브라우저 푸시: 스위치가 꺼져 있으면 흐리게 막고, 켜면 권한 상태별(SCR-SET-05 상태별 ①~⑦). 권한 창은 [허용하기]를 눌러야 띄운다.
// 끈 동안은 알림 센터에도 쌓이지 않는다. 푸시는 기기마다 따로라 이 기기 구독만 다룬다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { WorklogSettings } from '../api/types'
import { focusSectionHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { ConflictBanner, SaveError } from '../settings/parts'
import settingsStyles from '../settings/settings.module.css'
import { useWorklogMe, useWorklogSettingsSaver, type SettingsSaveResult } from '../settings/useWorklogSettings'
import { disablePush, enablePush, readPushState, type PushState } from './push'
import styles from './notificationSettings.module.css'

type Save = ReturnType<typeof useWorklogSettingsSaver>['save']
type Failure = Extract<SettingsSaveResult, { ok: false }>

export function NotificationSettings() {
  const { data, isPending, isError, refetch } = useWorklogMe()
  const { save, conflict, reload } = useWorklogSettingsSaver()
  const [reloaded, setReloaded] = useState<{ settings: WorklogSettings; count: number } | null>(null)

  return (
    <section aria-labelledby="settings-notifications" className={settingsStyles.panel}>
      {conflict && (
        <ConflictBanner
          onReload={async () => {
            const settings = await reload()
            if (settings) setReloaded((prev) => ({ settings, count: (prev?.count ?? 0) + 1 }))
          }}
        />
      )}
      <h2 id="settings-notifications" className={settingsStyles.panelTitle}>
        알림
      </h2>
      {isPending && <Skeleton count={3} />}
      {isError && (
        <p role="alert" className={settingsStyles.error}>
          설정을 불러오지 못했어요
          <button
            type="button"
            className={settingsStyles.retry}
            onClick={(e) => {
              focusSectionHeading(e.currentTarget)
              void refetch()
            }}
          >
            다시 시도
          </button>
        </p>
      )}
      {data && (
        <NotificationForm key={reloaded?.count ?? 0} settings={reloaded?.settings ?? data.settings} save={save} />
      )}
    </section>
  )
}

function NotificationForm({ settings, save }: { settings: WorklogSettings; save: Save }) {
  const id = useId()
  const [on, setOn] = useState(settings.dailyCloseNotifyEnabled)
  const [failure, setFailure] = useState<Failure | null>(null)
  const allowRef = useRef<HTMLButtonElement>(null)
  const [focusAllow, setFocusAllow] = useState(false)

  const change = async (next: boolean) => {
    const before = on
    setOn(next)
    // 켜면 바로 아래 [허용하기]로 포커스(자동으로 권한을 묻지는 않음)
    setFocusAllow(next)
    const result = await save({ dailyCloseNotifyEnabled: next })
    setFailure(result.ok ? null : result)
    if (!result.ok && result.reason === 'conflict') setOn(before)
  }

  return (
    <>
      <div className={styles.main}>
        <div className={settingsStyles.rowText}>
          <label htmlFor={`${id}-on`} className={styles.mainTitle}>
            하루 마감 알림
          </label>
          <div id={`${id}-on-desc`} className={styles.mainDescription}>
            켜면 하루 마감 시각에 오늘 기록을 정리하라고 알려 드려요. 확인 대기가 있으면 개수도 함께요. 처음에는 꺼져
            있어요.
          </div>
        </div>
        <button
          id={`${id}-on`}
          type="button"
          role="switch"
          aria-checked={on}
          aria-describedby={`${id}-on-desc ${id}-on-error`}
          className={settingsStyles.switch}
          onClick={() => void change(!on)}
        >
          <span className={settingsStyles.track}>
            <span className={settingsStyles.knob} />
          </span>
        </button>
      </div>
      <SaveError id={`${id}-on-error`} failure={failure} onRetry={() => void change(on)} />

      <div className={settingsStyles.row}>
        <div className={settingsStyles.rowText}>
          <div className={settingsStyles.rowTitle}>알림 시각</div>
          <div className={settingsStyles.rowDescription}>설정 › 일반의 하루 마감 시각과 같아요</div>
        </div>
        <Link
          to="/settings/general"
          className={styles.timeLink}
          aria-label={`알림 시각 ${settings.dailyCloseTime}, 일반 설정에서 바꾸기`}
        >
          {settings.dailyCloseTime} ›
        </Link>
      </div>

      <PushCard enabled={on} allowRef={allowRef} focusAllow={focusAllow} onFocused={() => setFocusAllow(false)} />
      <p className={settingsStyles.note}>푸시를 허용하지 않아도 알림은 앱 안 알림 센터에 모여요.</p>
    </>
  )
}

const BADGE: Partial<Record<PushState, { text: string; tone: 'off' | 'on' | 'blocked' }>> = {
  default: { text: '이 기기 꺼짐', tone: 'off' },
  'granted-off': { text: '이 기기 꺼짐', tone: 'off' },
  on: { text: '이 기기 켜짐', tone: 'on' },
  denied: { text: '차단됨', tone: 'blocked' },
  unsupported: { text: '지원 안 함', tone: 'off' },
}

function PushCard({
  enabled,
  allowRef,
  focusAllow,
  onFocused,
}: {
  enabled: boolean
  allowRef: React.RefObject<HTMLButtonElement | null>
  focusAllow: boolean
  onFocused: () => void
}) {
  const id = useId()
  const { showToast } = useToast()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [offFailed, setOffFailed] = useState(false)

  const refresh = useCallback(() => {
    void readPushState().then(setState, () => setState('unsupported'))
  }, [])

  useEffect(() => {
    refresh()
    // 브라우저 설정에서 권한을 바꾸고 돌아오면 다시 읽는다
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  useEffect(() => {
    if (!focusAllow || !enabled || state === null) return
    if (allowRef.current && !allowRef.current.disabled) allowRef.current.focus()
    onFocused()
  }, [focusAllow, enabled, state, allowRef, onFocused])

  const allow = async () => {
    setBusy(true)
    setFailed(false)
    // 오래된 Safari처럼 권한 묻기가 예외를 던지면 등록 실패로 본다
    const result = await enablePush().catch(() => 'failed' as const)
    setBusy(false)
    if (result === 'denied') showToast('알림을 차단했어요. 앱 안 알림 센터에서는 계속 볼 수 있어요')
    if (result === 'failed') setFailed(true)
    refresh()
  }

  const turnOff = async () => {
    setBusy(true)
    setOffFailed(false)
    try {
      await disablePush()
    } catch {
      setOffFailed(true)
    }
    setBusy(false)
    refresh()
  }

  const titleId = `${id}-t`
  const descId = `${id}-d`
  const title = (
    <div id={titleId} className={styles.pushTitle}>
      {state === 'ios-browser' ? '푸시 알림' : '브라우저 푸시 알림'}
    </div>
  )

  // 하루 마감 알림이 꺼져 있으면 흐리게 막는다(상태 배지는 보여 준다)
  if (!enabled || state === null) {
    return (
      <div
        className={`${styles.push} ${styles.pushOff}`}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className={styles.pushText}>
          {title}
          <div id={descId} className={styles.pushDescription}>
            하루 마감 알림을 켜면 고를 수 있어요
          </div>
        </div>
        {state && BADGE[state] && <Badge {...BADGE[state]} />}
        {(state === 'default' || state === 'granted-off') && (
          <button ref={allowRef} type="button" className={styles.allow} disabled>
            허용하기
          </button>
        )}
      </div>
    )
  }

  let description: React.ReactNode
  let action: React.ReactNode = null
  if (state === 'ios-browser') {
    description = (
      <>
        iPhone에서는 WY를 <b>홈 화면에 추가</b>해서 열어야 푸시 알림을 받을 수 있어요. Safari 공유 버튼 → 홈 화면에
        추가.
      </>
    )
  } else if (state === 'unsupported') {
    description = '이 브라우저는 푸시 알림을 받을 수 없어요. 알림은 앱 안 알림 센터로 알려 드려요.'
  } else if (state === 'denied') {
    description = (
      <>
        이 브라우저에서 알림을 차단했어요. 주소창 왼쪽 <b>사이트 정보</b> 아이콘 → <b>알림</b> → <b>허용</b>으로 바꾼 뒤
        이 화면을 새로 고쳐 주세요.
      </>
    )
  } else if (state === 'on') {
    description = offFailed ? (
      <span className={styles.pushError}>이 기기 구독을 지우지 못했어요. 다시 시도해 주세요.</span>
    ) : (
      '이 기기에서 받고 있어요'
    )
    action = (
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => void turnOff()}>
        이 기기에서 끄기
      </button>
    )
  } else {
    description = failed ? (
      <span className={styles.pushError}>알림 등록을 끝내지 못했어요. 다시 시도해 주세요.</span>
    ) : (
      '앱을 닫아도 하루 마감 알림을 받으려면 허용해 주세요'
    )
    action = (
      <button ref={allowRef} type="button" className={styles.allow} disabled={busy} onClick={() => void allow()}>
        {failed ? '다시 시도' : state === 'granted-off' ? '이 기기에서 켜기' : '허용하기'}
      </button>
    )
  }

  return (
    <div
      className={state === 'denied' ? `${styles.push} ${styles.pushBlocked}` : styles.push}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className={styles.pushText}>
        {title}
        <div id={descId} className={styles.pushDescription} aria-live="polite">
          {description}
        </div>
      </div>
      {BADGE[state] && <Badge {...BADGE[state]} />}
      {action}
    </div>
  )
}

function Badge({ text, tone }: { text: string; tone: 'off' | 'on' | 'blocked' }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{text}</span>
}

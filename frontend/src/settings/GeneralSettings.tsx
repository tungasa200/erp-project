// SCR-SET-02 설정 — 일반. ①시간대 ②주 시작 요일 ③업무 요일 ⑥키보드 단축키는 identity 프로필이고 바꾸는 즉시 항목별로 저장한다.
// ④업무 시간대(P2)·⑤하루 마감 시각(P3)은 worklog 설정이며 화면정의서 단계 표기에 따라 그 단계에서 같은 방식으로 더한다.
import { useId, useState, type ReactNode } from 'react'
import type { Me } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { WEEKDAY_NAMES } from '../quickInput/dates'
import { ConflictBanner, SaveError } from './parts'
import { TimeZoneCombobox } from './TimeZoneCombobox'
import styles from './settings.module.css'
import { useProfileSaver, type ProfilePatch, type SaveResult } from './useProfileSaver'

type Save = (patch: ProfilePatch) => Promise<SaveResult>
type Failure = Extract<SaveResult, { ok: false }>

const WEEK_STARTS: Me['weekStart'][] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

/** 값을 바꾸는 즉시 저장한다. 실패하면 고른 값을 그대로 두고 그 항목에 오류와 다시 시도를 보여 준다 */
function useInstantSave<T>(initial: T, toPatch: (value: T) => ProfilePatch, save: Save) {
  const [value, setValue] = useState(initial)
  const [failure, setFailure] = useState<Failure | null>(null)
  const change = async (next: T) => {
    setValue(next)
    const result = await save(toPatch(next))
    setFailure(result.ok ? null : result)
  }
  return { value, failure, change, retry: () => void change(value) }
}

export function GeneralSettings() {
  const { user } = useAuth()
  const { save, conflict, reload } = useProfileSaver()
  // 충돌 뒤 새로 불러오면 입력칸을 서버 값으로 다시 채운다(key로 다시 만든다).
  const [reloaded, setReloaded] = useState<{ me: Me; count: number } | null>(null)
  if (!user) return null

  return (
    <section aria-labelledby="settings-general" className={styles.panel}>
      {conflict && (
        <ConflictBanner
          onReload={async () => {
            const me = await reload()
            if (me) setReloaded((prev) => ({ me, count: (prev?.count ?? 0) + 1 }))
          }}
        />
      )}
      <h2 id="settings-general" className={styles.panelTitle}>
        일반
      </h2>
      <GeneralForm key={reloaded?.count ?? 0} user={reloaded?.me ?? user} save={save} />
    </section>
  )
}

function Row({ title, description, children }: { title: ReactNode; description: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>{title}</div>
        <div className={styles.rowDescription}>{description}</div>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

function GeneralForm({ user, save }: { user: Me; save: Save }) {
  const id = useId()
  const timezone = useInstantSave(user.timezone, (v) => ({ timezone: v }), save)
  const weekStart = useInstantSave(user.weekStart, (v) => ({ weekStart: v }), save)
  const workDays = useInstantSave(user.workDays, (v) => ({ workDays: v }), save)
  const shortcuts = useInstantSave(user.keyboardShortcutsEnabled, (v) => ({ keyboardShortcutsEnabled: v }), save)
  const [noDayError, setNoDayError] = useState(false)
  // 시간대 안내는 바꿨을 때 그 행 아래에 보여 주고 화면을 떠날 때까지 둔다 (erp-design)
  const [tzChanged, setTzChanged] = useState(false)

  const toggleDay = (bit: number) => {
    const next = workDays.value ^ bit
    // 요일을 하나도 고르지 않으면 저장하지 않는다(계약: 1~127)
    if (next === 0) {
      setNoDayError(true)
      return
    }
    setNoDayError(false)
    void workDays.change(next)
  }

  return (
    <>
      <Row title={<span id={`${id}-tz`}>시간대</span>} description="날짜와 시간을 이 기준으로 계산해요">
        <TimeZoneCombobox
          value={timezone.value}
          labelledBy={`${id}-tz`}
          describedBy={tzChanged ? `${id}-tz-note` : undefined}
          onChange={(zone) => {
            setTzChanged(true)
            void timezone.change(zone)
          }}
        />
      </Row>
      {tzChanged && (
        <p id={`${id}-tz-note`} role="note" className={styles.tzNote}>
          시간대를 바꿔도 기존 기록의 날짜는 그대로예요. 시각 표시만 새 시간대로 바뀌어요.
        </p>
      )}
      <SaveError id={`${id}-tz-error`} failure={timezone.failure} onRetry={timezone.retry} />

      <Row title={<label htmlFor={`${id}-ws`}>주 시작 요일</label>} description="캘린더와 주간 일지에 적용돼요">
        <select
          id={`${id}-ws`}
          className={styles.select}
          value={weekStart.value}
          onChange={(e) => void weekStart.change(e.target.value as Me['weekStart'])}
        >
          {WEEK_STARTS.map((w, i) => (
            <option key={w} value={w}>
              {WEEKDAY_NAMES[i]}요일
            </option>
          ))}
        </select>
      </Row>
      <SaveError id={`${id}-ws-error`} failure={weekStart.failure} onRetry={weekStart.retry} />

      <Row
        title={<span id={`${id}-wd`}>업무 요일</span>}
        description="주·월 마지막 근무일을 판단하는 기준이에요 (공휴일은 자동 제외)"
      >
        <div role="group" aria-labelledby={`${id}-wd`} className={styles.days}>
          {WEEKDAY_NAMES.map((name, i) => {
            const bit = 1 << i // 월=1 … 일=64
            const on = (workDays.value & bit) !== 0
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                className={on ? `${styles.day} ${styles.dayOn}` : styles.day}
                onClick={() => toggleDay(bit)}
              >
                {name}
              </button>
            )
          })}
        </div>
      </Row>
      {noDayError && (
        <p role="alert" className={styles.error}>
          업무 요일을 하루 이상 골라 주세요
        </p>
      )}
      <SaveError id={`${id}-wd-error`} failure={workDays.failure} onRetry={workDays.retry} />

      <Row
        title={<label htmlFor={`${id}-sc`}>키보드 단축키</label>}
        description="N, D·W·M·Y·A 같은 한 글자 단축키를 써요. 입력 중에는 동작하지 않아요"
      >
        {/* 보이는 스위치는 56x32, 누르는 영역은 44px 높이. 행 제목을 눌러도 켜고 끈다 */}
        <button
          id={`${id}-sc`}
          type="button"
          role="switch"
          aria-checked={shortcuts.value}
          aria-label="키보드 단축키 사용"
          className={styles.switch}
          onClick={() => void shortcuts.change(!shortcuts.value)}
        >
          <span className={styles.track}>
            <span className={styles.knob} />
          </span>
        </button>
      </Row>
      <SaveError id={`${id}-sc-error`} failure={shortcuts.failure} onRetry={shortcuts.retry} />
    </>
  )
}

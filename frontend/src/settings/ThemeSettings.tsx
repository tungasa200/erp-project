// SCR-SET-04 설정 — 테마 (P4-09, UX-07). 목업 SET-04(데스크톱)·SET-04m(390).
// 고르는 동안은 미리보기만 바뀌고, [저장]을 눌러야 PATCH /api/users/me로 앱 전체에 적용된다(AuthContext가 user 값으로 칠한다).
// 기록 상태 색과 프로젝트 색은 테마와 상관없이 고정이다.
import { useId, useState, type CSSProperties } from 'react'
import type { Me } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { DEFAULT_THEME, onColor } from '../theme/theme'
import { ConflictBanner, SaveError } from './parts'
import styles from './settings.module.css'
import theme from './theme.module.css'
import { useProfileSaver, type ProfilePatch, type SaveResult } from './useProfileSaver'

// 키 컬러 프리셋 8색 (목업 SET-04)
const ACCENTS = [
  { name: '보라', hex: '#4B3FD6' },
  { name: '파랑', hex: '#2D6BE4' },
  { name: '청록', hex: '#0E8A7E' },
  { name: '초록', hex: '#2F8F3E' },
  { name: '주황', hex: '#D9590B' },
  { name: '빨강', hex: '#D1344A' },
  { name: '분홍', hex: '#C2378B' },
  { name: '먹색', hex: '#2B2E3B' },
]

// 배경 4종 (identity 계약 themeGround enum). 다크는 준비 중이라 고를 수 없다
const GROUNDS: { name: string; hex: Ground }[] = [
  { name: '쿨 그레이', hex: '#F2F4FA' },
  { name: '웜 베이지', hex: '#F6F2EA' },
  { name: '세이지', hex: '#EEF4EF' },
  { name: '화이트', hex: '#FFFFFF' },
]

const INVALID_THEME: Record<string, string> = {
  THEME_ACCENT_INVALID: '이 키 컬러는 쓸 수 없어요',
  THEME_GROUND_INVALID: '이 배경은 쓸 수 없어요',
}

type Failure = Extract<SaveResult, { ok: false }>
type Ground = NonNullable<ProfilePatch['themeGround']>

export function ThemeSettings() {
  const { user } = useAuth()
  const { save, conflict, reload } = useProfileSaver()
  const [reloaded, setReloaded] = useState<{ me: Me; count: number } | null>(null)
  if (!user) return null
  return (
    <section aria-labelledby="settings-theme" className={styles.panel}>
      {conflict && (
        <ConflictBanner
          onReload={async () => {
            const me = await reload()
            if (me) setReloaded((prev) => ({ me, count: (prev?.count ?? 0) + 1 }))
          }}
        />
      )}
      <h2 id="settings-theme" className={styles.panelTitle}>
        테마
      </h2>
      <ThemeForm key={reloaded?.count ?? 0} user={reloaded?.me ?? user} save={save} />
    </section>
  )
}

function ThemeForm({ user, save }: { user: Me; save: ReturnType<typeof useProfileSaver>['save'] }) {
  const id = useId()
  const [accent, setAccent] = useState((user.themeAccent ?? DEFAULT_THEME.accent).toUpperCase())
  const [ground, setGround] = useState((user.themeGround ?? DEFAULT_THEME.ground).toUpperCase() as Ground)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [saved, setSaved] = useState(false)
  const on = onColor(accent)
  const flipped = on !== '#FFFFFF'

  const pickAccent = (hex: string) => {
    setAccent(hex.toUpperCase())
    setSaved(false)
  }
  const pickGround = (hex: Ground) => {
    setGround(hex)
    setSaved(false)
  }

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setSaved(false)
    const result = await save({ themeAccent: accent, themeGround: ground })
    setSaving(false)
    setFailure(result.ok ? null : result)
    setSaved(result.ok)
  }

  const previewStyle = { '--pv-accent': accent, '--pv-on': on, '--pv-ground': ground } as CSSProperties

  return (
    <div className={theme.layout}>
      <div className={theme.controls}>
        <section aria-labelledby={`${id}-accent`} className={theme.group}>
          <h3 id={`${id}-accent`} className={theme.groupTitle}>
            키 컬러
          </h3>
          <p className={theme.groupLead}>버튼, 선택된 메뉴, 오늘 표시에 쓰여요. 프로젝트 색은 바뀌지 않아요.</p>
          <div role="group" aria-labelledby={`${id}-accent`} className={theme.swatches}>
            {ACCENTS.map((a) => {
              const selected = a.hex === accent
              return (
                <button
                  key={a.hex}
                  type="button"
                  aria-pressed={selected}
                  className={theme.swatch}
                  onClick={() => pickAccent(a.hex)}
                >
                  <span
                    className={theme.dot}
                    style={{
                      background: a.hex,
                      color: onColor(a.hex),
                      boxShadow: selected ? `0 0 0 3px #FFFFFF, 0 0 0 5px ${a.hex}` : undefined,
                    }}
                    aria-hidden="true"
                  >
                    {selected ? '✓' : ''}
                  </span>
                  {a.name}
                </button>
              )
            })}
          </div>
          <div className={theme.custom}>
            <label htmlFor={`${id}-custom`} className={theme.customLabel}>
              직접 고르기
            </label>
            <input
              id={`${id}-custom`}
              type="color"
              className={theme.colorInput}
              value={accent.toLowerCase()}
              aria-describedby={`${id}-hex`}
              onChange={(e) => pickAccent(e.target.value)}
            />
            <span id={`${id}-hex`} className={theme.hex}>
              {accent}
            </span>
          </div>
          {flipped && (
            <p role="note" className={theme.flipNote}>
              밝은 색이라 버튼 글자를 진한 색으로 바꿨어요
            </p>
          )}
        </section>

        <section aria-labelledby={`${id}-ground`} className={theme.group}>
          <h3 id={`${id}-ground`} className={theme.groupTitle}>
            배경
          </h3>
          <div role="group" aria-labelledby={`${id}-ground`} className={theme.grounds}>
            {GROUNDS.map((g) => (
              <button
                key={g.hex}
                type="button"
                aria-pressed={g.hex === ground}
                className={theme.ground}
                onClick={() => pickGround(g.hex)}
              >
                <span className={theme.groundSample} style={{ background: g.hex }} aria-hidden="true">
                  <span style={{ background: g.hex === '#FFFFFF' ? '#F2F4FA' : '#FFFFFF' }} />
                </span>
                {g.name}
              </button>
            ))}
            <button type="button" className={theme.ground} disabled>
              <span className={`${theme.groundSample} ${theme.groundDark}`} aria-hidden="true">
                <span />
              </span>
              다크 (준비 중)
            </button>
          </div>
        </section>

        <div className={theme.actions}>
          <button
            type="button"
            className={theme.reset}
            onClick={() => {
              pickAccent(DEFAULT_THEME.accent)
              pickGround(DEFAULT_THEME.ground as Ground)
            }}
          >
            기본값으로
          </button>
          <button
            type="button"
            className={theme.save}
            aria-describedby={failure ? `${id}-error` : undefined}
            aria-busy={saving}
            onClick={() => void submit()}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
        <p role="status" className={theme.status}>
          {saved ? '저장했어요. 앱 전체에 적용됐어요' : ''}
        </p>
        {failure?.reason === 'invalid' && failure.code && INVALID_THEME[failure.code] ? (
          <p id={`${id}-error`} role="alert" className={styles.error}>
            {INVALID_THEME[failure.code]}
          </p>
        ) : (
          <SaveError id={`${id}-error`} failure={failure} onRetry={() => void submit()} />
        )}
      </div>

      <section aria-labelledby={`${id}-preview`} className={theme.previewArea}>
        <h3 id={`${id}-preview`} className={theme.previewTitle}>
          미리보기
        </h3>
        {/* 그림이라 읽지 않는다. 고른 색만 이 안에서 쓴다 */}
        <div className={theme.preview} style={previewStyle} aria-hidden="true">
          <div className={theme.pvNav}>
            <div className={theme.pvNavActive}>홈</div>
            <div className={theme.pvNavItem}>캘린더</div>
            <div className={theme.pvNavItem}>업무</div>
          </div>
          <div className={theme.pvMain}>
            <div className={theme.pvGreeting}>좋은 오후예요</div>
            <div className={theme.pvStats}>
              <div className={theme.pvStatAccent}>
                <div className={theme.pvStatLabel}>남은 업무</div>
                <div className={theme.pvStatValue}>11</div>
              </div>
              <div className={theme.pvStat}>
                <div className={theme.pvStatLabel}>오늘 일정</div>
                <div className={theme.pvStatValue}>5</div>
              </div>
            </div>
            <div className={theme.pvBlocks}>
              <div className={`${theme.pvBlock} ${theme.pvDone}`}>결제 API 설계 · 완료</div>
              <div className={`${theme.pvBlock} ${theme.pvPending}`}>고객사 미팅 · 확인해 주세요</div>
              <div className={`${theme.pvBlock} ${theme.pvPlanned}`}>견적서 작성 · 예정</div>
            </div>
            <div className={theme.pvLog}>
              <span>오늘 업무일지</span>
              <span className={theme.pvClose}>하루 마감</span>
            </div>
          </div>
        </div>
        <p className={theme.previewNote}>기록 상태 색과 프로젝트 색은 테마와 상관없이 그대로예요.</p>
      </section>
    </div>
  )
}

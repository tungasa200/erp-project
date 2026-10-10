// SCR-MOB-01 빠른 기록 바텀시트 (P4-03, UX-02). 모바일 하단 탭 가운데 +와 PWA 바로가기 '빠른 기록'(?quick=1)이 연다.
// 입력은 홈 빠른 입력과 같은 문법·저장(SCR-COM-02, D-182): 시간을 적으면 업무와 일정을 함께 만든다.
// 손잡이·Esc·바깥 누르기·아래로 끌기로 닫고, 쓰던 글은 남긴다(글은 AppShell이 들고 있다).
// 입력 중에는 해석 칩만 보이고 확인 대기·타이머는 숨긴다. 끊긴 동안에는 입력·저장·했어요를 끈다(SCR-SYS-02 ③).
// 열린 동안 Tab은 시트 안을 돌고, 닫으면 연 자리(+ 버튼)로 포커스를 돌린다.
import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { QuickInput } from '../quickInput/QuickInput'
import { shortDate, todayIn } from '../quickInput/dates'
import { planTime, usePendingRecords } from '../records/pending'
import { usePendingDecision } from '../records/usePendingDecision'
import { useQuickSave } from '../tasks/useQuickSave'
import { markFocus, restoreFocus } from './focusRescue'
import styles from './QuickSheet.module.css'
import { useOnline } from './useOnline'

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
/** 이만큼 아래로 끌면 닫는다(px) */
const DRAG_CLOSE = 80

interface Props {
  text: string
  onTextChange: (text: string) => void
  onClose: () => void
  /** 확인 대기 'n건 더 보기' → SCR-HOME-02 */
  onOpenPending: () => void
  /** 시간 기록 옵션이 켜졌을 때만 준다 */
  onStartTimer?: () => void
}

export function QuickSheet({ text, onTextChange, onClose, onOpenPending, onStartTimer }: Props) {
  const titleId = useId()
  const sheet = useRef<HTMLElement>(null)
  const online = useOnline()
  const quickSave = useQuickSave()
  const typing = text.trim() !== ''

  // 입력칸으로, 끊겨서 막혀 있으면 손잡이(닫기)로
  const focusStart = () =>
    (
      sheet.current?.querySelector<HTMLElement>('[data-quick-input]:not(:disabled)') ??
      sheet.current?.querySelector<HTMLElement>('button')
    )?.focus()

  // 열 때 입력칸으로, 닫으면 연 자리로
  useEffect(() => {
    const previous = markFocus()
    focusStart()
    return () => restoreFocus(previous)
  }, [])

  // 입력 중에 끊겨 입력칸이 막히면 포커스가 시트 밖으로 빠지지 않게 한다
  useEffect(() => {
    const active = document.activeElement
    if (!sheet.current?.contains(active) || active?.matches(':disabled')) focusStart()
  }, [online])

  // 휴대폰 키보드가 올라오면 시트를 그 위로 올린다(visualViewport)
  const [keyboard, setKeyboard] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  // 손잡이를 아래로 끌기
  const drag = useRef<{ y: number; id: number } | null>(null)
  const [dragY, setDragY] = useState(0)

  return (
    <div className={styles.backdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.sheet}
        style={{ bottom: keyboard, transform: dragY ? `translateY(${dragY}px)` : undefined }}
        // 입력칸의 Esc는 홈에서는 글을 지우지만, 시트에서는 글을 남기고 닫는다(칩 고치기·도움말의 Esc는 그대로)
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape' && (e.target as HTMLElement).matches('[data-quick-input]')) {
            e.stopPropagation()
            onClose()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Tab') {
            const items = Array.from(sheet.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])
            const first = items[0]
            const last = items[items.length - 1]
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <button
          type="button"
          className={styles.grip}
          aria-label="빠른 기록 닫기"
          onClick={() => !dragY && onClose()}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, id: e.pointerId }
            e.currentTarget.setPointerCapture?.(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (drag.current?.id === e.pointerId) setDragY(Math.max(0, e.clientY - drag.current.y))
          }}
          onPointerUp={() => {
            drag.current = null
            if (dragY > DRAG_CLOSE) onClose()
            else setDragY(0)
          }}
          onPointerCancel={() => {
            drag.current = null
            setDragY(0)
          }}
        >
          <span aria-hidden="true" />
        </button>
        <h2 id={titleId} className={styles.title}>
          빠른 기록
        </h2>
        <fieldset className={styles.input} disabled={!online}>
          <QuickInput
            value={text}
            onChange={onTextChange}
            onSubmit={async (draft) => {
              await quickSave(draft)
              onClose()
            }}
            label="한 줄 입력"
            placeholder={online ? '예: 14-16 견적서 작성 @영업' : '연결되면 입력할 수 있어요'}
          />
        </fieldset>
        {!typing && (
          <>
            <p className={styles.hint}>시간을 적으면 일정도 함께 만들어져요.</p>
            <PendingCard
              disabled={!online}
              onLastDone={focusStart}
              onMore={() => {
                onClose()
                onOpenPending()
              }}
            />
            {onStartTimer && (
              <button
                type="button"
                className={styles.timer}
                disabled={!online}
                onClick={() => {
                  onClose()
                  onStartTimer()
                }}
              >
                <span className={styles.timerDot} aria-hidden="true" />
                지금 하는 일로 타이머 시작
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

// 확인 대기 1건 + 'n건 더 보기'. 없으면(받기 전·실패 포함) 자리째 숨긴다.
// 마지막 1건을 했어요로 바꾸면 카드가 사라지므로 포커스를 입력칸으로 옮긴다(onLastDone)
function PendingCard({
  disabled,
  onMore,
  onLastDone,
}: {
  disabled: boolean
  onMore: () => void
  onLastDone: () => void
}) {
  const { user } = useAuth()
  const timeZone = user?.timezone ?? 'Asia/Seoul'
  const pending = usePendingRecords()
  const { decide } = usePendingDecision()
  const [busy, setBusy] = useState(false)
  const items = pending.data ?? []
  const first = items[0]
  if (!first) return null

  const today = todayIn(timeZone)
  const day = first.plan.startDate
    ? first.plan.startDate === today
      ? '오늘'
      : shortDate(first.plan.startDate, today)
    : ''
  const when = [day, planTime(first.plan, timeZone)].filter(Boolean).join(' ')
  return (
    <div className={styles.pending}>
      <div className={styles.pendingText}>
        <p className={styles.pendingMeta}>확인 대기{when ? ` · ${when}` : ''}</p>
        <p className={styles.pendingTitle}>{first.plan.title}</p>
        {items.length > 1 && (
          <button type="button" className={styles.pendingMore} onClick={onMore}>
            {items.length - 1}건 더 보기
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.done}
        disabled={disabled || busy}
        aria-label={`${first.plan.title} 했어요`}
        onClick={async () => {
          setBusy(true)
          const saved = await decide(first, 'CONFIRMED')
          setBusy(false)
          if (saved && items.length === 1) onLastDone()
        }}
      >
        했어요
      </button>
    </div>
  )
}

// 설정 화면 공통 조각: 항목별 저장 오류, 동시 수정 충돌 띠 (화면정의서 2.5)
import type { ReactNode } from 'react'
import { CopyCodeButton } from '../components/CopyCodeButton'
import { focusSectionHeading } from '../components/focusFallback'
import styles from './settings.module.css'
import type { SaveResult } from './useProfileSaver'

type Failure = Extract<SaveResult, { ok: false }>

const INVALID_MESSAGE: Record<string, string> = {
  TOO_LONG: '100자 이하로 적어 주세요',
  TIMEZONE_INVALID: '지원하지 않는 시간대예요',
  WORK_DAYS_INVALID: '업무 요일을 하루 이상 골라 주세요',
  INVALID_ORDER: '종료 시각은 시작 시각보다 늦어야 해요',
}

/** 설정 한 항목: 왼쪽 제목·설명, 오른쪽 입력 */
export function Row({ title, description, children }: { title: ReactNode; description: string; children: ReactNode }) {
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

/** 그 항목 아래에 보여 줄 저장 실패 안내. 충돌은 화면 위 띠가 대신 알린다 */
export function SaveError({ id, failure, onRetry }: { id: string; failure: Failure | null; onRetry: () => void }) {
  if (!failure || failure.reason === 'conflict') return null
  if (failure.reason === 'invalid') {
    return (
      <p id={id} role="alert" className={styles.error}>
        {INVALID_MESSAGE[failure.code ?? ''] ?? '입력한 값을 확인해 주세요'}
      </p>
    )
  }
  return (
    <div id={id} role="alert" className={styles.error}>
      <span>{failure.reason === 'network' ? '연결이 끊겨 저장하지 못했어요' : '저장하지 못했어요'}</span>
      <button
        type="button"
        className={styles.retry}
        onClick={() => {
          // 성공하면 이 안내가 사라지므로 이 안내를 가리키는 입력칸으로 포커스를 옮긴다
          document.querySelector<HTMLElement>(`[aria-describedby~="${id}"]`)?.focus()
          onRetry()
        }}
      >
        다시 시도
      </button>
      {failure.traceId && <CopyCodeButton code={failure.traceId} />}
    </div>
  )
}

export function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div role="alert" className={styles.conflict}>
      <span>다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요</span>
      <button
        type="button"
        className={styles.reload}
        onClick={(e) => {
          focusSectionHeading(e.currentTarget)
          onReload()
        }}
      >
        새로 불러오기
      </button>
    </div>
  )
}

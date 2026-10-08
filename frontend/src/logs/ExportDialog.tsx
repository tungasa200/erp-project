// SCR-LOG-05 내보내기 (EXP-01~04, P3-10) + SCR-LOG-06 내보내기 전 이메일 인증 (AUTH-08, D-41·D-109).
// 형식: 텍스트 복사(화면에서 만듦) / PDF / Word / Excel(이 일지 또는 기간 업무 기록). 파일 이름은 서버 응답의 이름을 쓰고
// 미리보기는 같은 규칙으로 만든다. 미인증이면 텍스트 복사도 먼저 인증을 받고(화면 안내), 서버 403도 같은 단계로 보낸다.
// 인증을 마치면 고른 내보내기를 그대로 이어서 한다.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/problem'
import { ME_QUERY_KEY } from '../auth/session'
import { useAuth } from '../auth/useAuth'
import { Modal } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { useToast } from '../components/useToast'
import { verificationApi } from '../verification/api'
import { EmailVerificationDialog } from '../verification/EmailVerificationDialog'
import { logApi, type ExportFormat, type LogContent, type LogStatus, type LogType } from './api'
import { periodText } from './format'
import { logToText } from './logText'
import styles from './exportDialog.module.css'
import logStyles from './logs.module.css'

type Format = 'TEXT' | ExportFormat
type Range = 'LOG' | 'RECORDS'

const FORMATS: { value: Format; name: string; hint: string }[] = [
  { value: 'TEXT', name: '텍스트 복사', hint: '메신저·메일에 붙여넣기' },
  { value: 'PDF', name: 'PDF', hint: '그대로 제출·인쇄' },
  { value: 'DOCX', name: 'Word', hint: '회사 양식에 옮겨 고치기' },
  { value: 'XLSX', name: 'Excel', hint: '일지 + 그 기간 원본 기록' },
]
const EXT: Record<ExportFormat, string> = { PDF: 'pdf', DOCX: 'docx', XLSX: 'xlsx' }
const MAX_DAYS = 400
/** 파일 생성이 이보다 길면 진행 표시 (SCR-LOG-05) */
const SLOW_MS = 3000

export interface ExportTarget {
  type: LogType
  periodStart: string
  periodEnd: string
  status: LogStatus
  content: LogContent
}

interface Props {
  log: ExportTarget
  timeZone: string
  onClose: () => void
}

// 서버와 같은 규칙: 이름의 / \ : * ? " < > |와 제어 문자는 _, 이름이 비면 "_이름"을 뺀다
function safeName(name: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (name ?? '').trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
  return cleaned ? `_${cleaned}` : ''
}

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ExportDialog({ log, timeZone, onClose }: Props) {
  const id = useId()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  // 인증 창에서 돌아올 때 포커스가 body로 빠지면 다시 열린 모달이 엉뚱한 자리를 기억하므로, 연 버튼을 따로 기억해 먼저 돌려 둔다
  const [origin] = useState(() => document.activeElement as HTMLElement | null)
  const backToForm = () => {
    origin?.focus()
    setStep('form')
  }
  const [step, setStep] = useState<'form' | 'ask' | 'verify'>('form')
  const [format, setFormat] = useState<Format>('PDF')
  const [range, setRange] = useState<Range>('LOG')
  const [from, setFrom] = useState(log.periodStart)
  const [to, setTo] = useState(log.periodEnd)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const askRef = useRef<HTMLButtonElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  // 실패하면 [내려받기]로 포커스를 되돌린다. 만드는 동안 disabled라 포커스가 body로 빠지므로, 다시 켜진 뒤에 옮긴다
  const refocusRef = useRef(false)

  const records = format === 'XLSX' && range === 'RECORDS'
  const rangeError = !records
    ? null
    : !from || !to
      ? '시작일과 종료일을 넣어 주세요'
      : to < from
        ? '종료일이 시작일보다 빨라요'
        : dayCount(from, to) > MAX_DAYS
          ? `${MAX_DAYS}일까지 내보낼 수 있어요`
          : null
  const name = safeName(user?.name ?? log.content.author.name)
  const fileName =
    format === 'TEXT'
      ? null
      : records
        ? `업무기록_${from}_${to}${name}.xlsx`
        : `업무일지_${log.periodStart}${name}.${EXT[format]}`

  // 열 때·인증 단계에서 돌아올 때 고른 형식에 포커스(모달은 첫 입력을 고르므로 그 뒤에 옮긴다)
  useEffect(() => {
    if (step === 'form') formRef.current?.querySelector<HTMLInputElement>('input[name$="-format"]:checked')?.focus()
    if (step === 'ask') askRef.current?.focus()
  }, [step])

  useEffect(() => {
    if (busy || !refocusRef.current) return
    refocusRef.current = false
    submitRef.current?.focus()
  }, [busy])

  const run = async (verified = false) => {
    if (busy) return
    if (!verified && user && !user.emailVerified) {
      setStep('ask')
      return
    }
    setError(null)
    if (format === 'TEXT') {
      try {
        await navigator.clipboard.writeText(logToText({ ...log, draft: log.status !== 'CONFIRMED', timeZone }))
      } catch {
        setError('복사하지 못했어요. 브라우저가 클립보드 사용을 막았는지 확인해 주세요')
        return
      }
      showToast('일지를 복사했어요')
      onClose()
      return
    }
    setBusy(true)
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    try {
      const file = records
        ? await logApi.exportRecords(from, to)
        : await logApi.exportLog(log.type, log.periodStart, format)
      saveFile(file.blob, file.name ?? fileName!)
      showToast('파일을 내려받았어요')
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') {
        // 다른 곳에서 인증이 풀린 경우 등: 사용자 정보를 맞추고 인증 단계로
        void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
        setStep('ask')
        return
      }
      refocusRef.current = true
      if (e instanceof ApiError && e.status === 503) {
        setError('지금은 계정 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요')
      } else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
        setError(`기간을 확인해 주세요. ${MAX_DAYS}일까지 내보낼 수 있어요`)
      } else {
        setError('파일을 만들지 못했어요. 잠시 후 다시 시도해 주세요')
      }
    } finally {
      clearTimeout(timer)
      setBusy(false)
      setSlow(false)
    }
  }

  if (step === 'verify')
    return (
      <EmailVerificationDialog
        onClose={backToForm}
        onVerified={() => {
          backToForm()
          void run(true)
        }}
      />
    )

  if (step === 'ask')
    return (
      <Modal labelledBy={`${id}-ask`} onClose={onClose} narrow>
        <h2 id={`${id}-ask`} className={logStyles.dialogTitle}>
          이메일 인증이 필요해요
        </h2>
        <p className={logStyles.dialogBody}>
          일지를 내보내려면 <b>{user?.email}</b> 인증이 필요해요. 인증을 마치면 고른 내보내기를 바로 이어서 해요.
        </p>
        <div className={cal.actions}>
          <button type="button" className={cal.secondary} onClick={onClose}>
            취소
          </button>
          <button
            ref={askRef}
            type="button"
            className={cal.primary}
            disabled={busy}
            onClick={async () => {
              // 버튼 이름대로 코드를 먼저 보낸다. 아직 다시 받을 수 없거나(429) 이미 인증했으면 인증 창이 그 상태를 보여 준다
              setBusy(true)
              await verificationApi.send().catch(() => {})
              setBusy(false)
              setStep('verify')
            }}
          >
            인증 코드 받기
          </button>
        </div>
      </Modal>
    )

  return (
    <Modal labelledBy={`${id}-t`} onClose={onClose}>
      <form
        ref={formRef}
        className={styles.form}
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <h2 id={`${id}-t`} className={logStyles.dialogTitle}>
          내보내기
        </h2>
        <p className={styles.lead}>
          {periodText(log.type, log.periodStart, log.periodEnd)} {log.content.title}
        </p>
        {log.status !== 'CONFIRMED' && (
          <p className={styles.warning} role="note">
            확정 전 일지예요. 내보낸 뒤에 내용이 바뀔 수 있어요.
          </p>
        )}

        <fieldset className={styles.group} disabled={busy}>
          <legend className={styles.legend}>형식</legend>
          <div className={styles.formats}>
            {FORMATS.map((f) => (
              <label key={f.value} className={styles.option}>
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={f.value}
                  checked={format === f.value}
                  aria-describedby={`${id}-${f.value}`}
                  onChange={() => {
                    setFormat(f.value)
                    setError(null)
                  }}
                />
                <span className={styles.optionName}>{f.name}</span>
                <span id={`${id}-${f.value}`} className={styles.optionHint}>
                  {f.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {format === 'XLSX' && (
          <fieldset className={styles.group} disabled={busy}>
            <legend className={styles.legend}>Excel 범위</legend>
            <div className={styles.formats}>
              <label className={styles.option}>
                <input type="radio" name={`${id}-range`} checked={range === 'LOG'} onChange={() => setRange('LOG')} />
                <span className={styles.optionName}>이 일지</span>
              </label>
              <label className={styles.option}>
                <input
                  type="radio"
                  name={`${id}-range`}
                  checked={range === 'RECORDS'}
                  onChange={() => setRange('RECORDS')}
                />
                <span className={styles.optionName}>기간 업무 기록</span>
              </label>
            </div>
            {range === 'RECORDS' && (
              <>
                <div className={styles.range}>
                  <label className={cal.field}>
                    시작일
                    <input
                      type="date"
                      className={cal.input}
                      value={from}
                      required
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? `${id}-range-error` : undefined}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label className={cal.field}>
                    종료일
                    <input
                      type="date"
                      className={cal.input}
                      value={to}
                      required
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? `${id}-range-error` : undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>
                {rangeError && (
                  <p id={`${id}-range-error`} className={cal.fieldError}>
                    {rangeError}
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}

        {fileName && (
          <p className={styles.fileName}>
            파일 이름
            <output>{fileName}</output>
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <div className={cal.actions}>
          <p className={styles.progress} role="status">
            {slow ? '파일을 만들고 있어요' : ''}
          </p>
          <button type="button" className={cal.secondary} onClick={onClose}>
            취소
          </button>
          <button ref={submitRef} type="submit" className={cal.primary} disabled={busy || rangeError !== null}>
            {format === 'TEXT' ? '복사' : busy ? '만드는 중' : '내려받기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

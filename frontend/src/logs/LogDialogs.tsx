// SCR-LOG-02 다시 채우기 확인창, SCR-LOG-04 ① 확정 해제 확인창·② 변경 이력 (UX-03 확인창 예외).
// 확인창은 [취소]가 먼저 오고 처음 포커스도 [취소]다(되돌릴 수 없는 동작).
import { useQuery } from '@tanstack/react-query'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Modal } from '../calendar/Modal'
import cal from '../calendar/calendar.module.css'
import { Skeleton } from '../components/Skeleton'
import { logApi, type WorkLog } from './api'
import { stamp } from './format'
import { LogPaper } from './LogPaper'
import styles from './logs.module.css'

interface ConfirmProps {
  title: string
  body: string
  action: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ title, body, action, busy, onCancel, onConfirm }: ConfirmProps) {
  const id = useId()
  return (
    <Modal labelledBy={`${id}-t`} onClose={onCancel} narrow role="alertdialog">
      <h2 id={`${id}-t`} className={styles.dialogTitle}>
        {title}
      </h2>
      <p id={`${id}-b`} className={styles.dialogBody}>
        {body}
      </p>
      <div className={cal.actions}>
        <button type="button" className={cal.secondary} onClick={onCancel}>
          취소
        </button>
        <button type="button" className={styles.dangerFill} disabled={busy} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </Modal>
  )
}

export function RevisionsDialog({ log, timeZone, onClose }: { log: WorkLog; timeZone: string; onClose: () => void }) {
  const id = useId()
  const [open, setOpen] = useState<number | null>(null)
  const list = useQuery({ queryKey: ['logs', 'revisions', log.id], queryFn: () => logApi.revisions(log.id!) })
  const detail = useQuery({
    queryKey: ['logs', 'revision', log.id, open],
    queryFn: () => logApi.revision(log.id!, open!),
    enabled: open != null,
  })
  // 누른 줄·[← 이력 목록]이 사라지므로 전환할 때 포커스를 창 안 짝으로 옮긴다(P3-QA-LOG-04-K1).
  // layout effect라야 앱의 포커스 안전망이 body를 보고 화면 제목으로 보내기 전에 잡는다
  const backRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const lastOpened = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (open != null) {
      lastOpened.current = open
      backRef.current?.focus()
    } else if (lastOpened.current != null) {
      listRef.current?.querySelector<HTMLElement>(`[data-revision="${lastOpened.current}"]`)?.focus()
    }
  }, [open])
  return (
    <Modal labelledBy={`${id}-t`} onClose={onClose}>
      <div className={cal.dialogHead}>
        <h2 id={`${id}-t`}>{open == null ? '변경 이력' : `${open}번째 확정본`}</h2>
        <button type="button" className={cal.close} aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      {open == null ? (
        list.isPending ? (
          <Skeleton />
        ) : list.isError ? (
          <p className={styles.muted}>이력을 불러오지 못했어요.</p>
        ) : list.data.items.length === 0 ? (
          <p className={styles.muted}>아직 확정한 적이 없어요. 확정할 때마다 한 줄씩 남아요.</p>
        ) : (
          <ul ref={listRef} className={styles.revisions}>
            {list.data.items.map((r) => (
              <li key={r.revisionNo}>
                <button
                  type="button"
                  className={styles.revision}
                  data-revision={r.revisionNo}
                  onClick={() => setOpen(r.revisionNo)}
                >
                  <span className={styles.revisionNo}>{r.revisionNo}번째 확정</span>
                  <span>확정 {stamp(r.confirmedAt, timeZone)}</span>
                  <span className={styles.muted}>
                    {r.unconfirmedAt ? `해제 ${stamp(r.unconfirmedAt, timeZone)}` : '지금 확정본'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <button ref={backRef} type="button" className={cal.secondary} onClick={() => setOpen(null)}>
            ← 이력 목록
          </button>
          {detail.isPending ? (
            <Skeleton shape="block" height={240} />
          ) : detail.isError ? (
            <p className={styles.muted}>확정본을 불러오지 못했어요.</p>
          ) : (
            <div className={styles.revisionPaper}>
              <LogPaper
                type={log.type}
                periodStart={log.periodStart}
                periodEnd={log.periodEnd}
                content={detail.data.content}
                draft={false}
                confirmedAt={detail.data.confirmedAt}
                timeZone={timeZone}
              />
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

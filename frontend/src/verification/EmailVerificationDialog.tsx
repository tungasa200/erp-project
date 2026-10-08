// SCR-AUTH-08 이메일 인증 코드 입력 (모달, 모바일은 전체 화면). 가입 직후 서버가 첫 코드를 보내 두므로
// 열 때 진행 상태(GET)를 받아 남은 시간·다시 받기 시각을 이어서 보여 준다. 유효한 코드가 없으면 "새 코드 받기"부터.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ApiError } from '../api/problem'
import type { Me } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { ME_QUERY_KEY } from '../auth/session'
import { focusPageHeading } from '../components/focusFallback'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { verificationApi, type CodeTimes } from './api'
import { CodeStep } from './CodeStep'
import styles from './dialog.module.css'

interface Props {
  onClose: () => void
  /** 인증을 마치면 닫는 대신 이것을 부른다(내보내기에서 들어온 경우 이어서 실행, SCR-LOG-06). 포커스는 부른 쪽이 맡는다 */
  onVerified?: () => void
}

export function EmailVerificationDialog({ onClose, onVerified }: Props) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const status = useQuery({ queryKey: ['email-verification'], queryFn: verificationApi.status, gcTime: 0 })

  // 열면 포커스를 모달 안으로. 코드 칸(또는 잠겼으면 새 코드 받기)이 그려지면 그쪽이 이어받는다 (SCR-AUTH-08)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus()
  }, [])

  const finish = (me: Me) => {
    queryClient.setQueryData(ME_QUERY_KEY, me)
    if (onVerified) {
      showToast('이메일 인증을 마쳤어요')
      onVerified()
      return
    }
    onClose()
    // 인증하면 배너(포커스를 돌려줄 [인증하기])가 사라지므로 화면 제목으로 옮긴다
    focusPageHeading()
    showToast('이메일 인증을 마쳤어요')
  }

  // 다른 기기에서 이미 인증했으면 사용자 정보를 다시 받아 배너를 없앤다.
  const alreadyVerified = () => {
    void queryClient.refetchQueries({ queryKey: ME_QUERY_KEY })
    if (onVerified) {
      onVerified()
      return
    }
    onClose()
    focusPageHeading()
    showToast('이미 인증한 이메일이에요')
  }

  const times: CodeTimes | null = status.data
    ? {
        expiresAt: status.data.expiresAt ? new Date(status.data.expiresAt) : null,
        resendAt: status.data.resendAvailableAt ? new Date(status.data.resendAvailableAt) : null,
      }
    : null

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-title"
        className={styles.dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className={styles.head}>
          <span className={styles.icon} aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
            </svg>
          </span>
          <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <h2 id="verify-title" className={styles.title}>
          이메일 인증
        </h2>
        <p className={styles.lead}>
          <b className={styles.email}>{user?.email}</b>으로 보낸 6자리 숫자를 입력하세요.
        </p>

        {status.isPending && <Skeleton count={2} />}
        {status.isError && (
          <p role="alert" className={styles.error}>
            인증 상태를 불러오지 못했어요
            <button type="button" className={styles.retry} onClick={() => void status.refetch()}>
              다시 시도
            </button>
          </p>
        )}
        {status.data?.verified && (
          <p className={styles.muted}>
            이미 인증을 마쳤어요.{' '}
            <button type="button" className={styles.retry} onClick={alreadyVerified}>
              닫기
            </button>
          </p>
        )}
        {times && !status.data?.verified && (
          <CodeStep
            initial={times}
            autoFocus
            check={async (code) => finish(await verificationApi.confirm(code))}
            resend={async () => {
              try {
                return await verificationApi.send()
              } catch (error) {
                if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_VERIFIED') alreadyVerified()
                throw error
              }
            }}
            onVerified={() => {}}
          />
        )}

        <p className={styles.muted}>메일이 안 왔나요? 스팸함을 확인해 주세요.</p>
      </div>
    </div>
  )
}

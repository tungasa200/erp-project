// 이메일 인증 필수(사용자 지시 2026-10-13, D-20 뒤집음). 로그인했지만 인증하지 않은 사용자는 앱 대신 이 화면만 본다(RequireAuth).
// 가입 직후 서버가 첫 코드를 보내 두므로(D-64) 진행 상태(GET)로 남은 시간·다시 받기 시각을 이어서 보여 준다.
// 코드 입력은 인증 모달(SCR-AUTH-08)과 같은 CodeStep, 틀은 로그인·가입·비밀번호 화면과 같은 AuthLayout.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../api/problem'
import { useAuth } from '../auth/useAuth'
import { ME_QUERY_KEY } from '../auth/session'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/useToast'
import { verificationApi, type CodeTimes } from '../verification/api'
import { CodeStep } from '../verification/CodeStep'
import { AuthLayout } from './auth/AuthLayout'
import styles from './password/password.module.css'

export function VerifyEmailPage() {
  const { user, logout } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const status = useQuery({ queryKey: ['email-verification'], queryFn: verificationApi.status, gcTime: 0 })
  const [leaving, setLeaving] = useState(false)

  // 내 정보가 인증됨으로 바뀌면 가드가 홈으로 보낸다
  const alreadyVerified = () => {
    void queryClient.refetchQueries({ queryKey: ME_QUERY_KEY })
  }

  // logout은 서버 요청이 실패해도 이 기기 세션을 지운다. 끝나면 가드가 로그인 화면으로 보낸다
  const signOut = () => {
    setLeaving(true)
    void logout()
  }

  const times: CodeTimes | null = status.data
    ? {
        expiresAt: status.data.expiresAt ? new Date(status.data.expiresAt) : null,
        resendAt: status.data.resendAvailableAt ? new Date(status.data.resendAvailableAt) : null,
      }
    : null

  return (
    <AuthLayout heading="이메일 인증을 마치면 시작할 수 있어요">
      <div className={styles.form}>
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
        <h1 className={styles.title}>이메일 인증</h1>
        <p className={styles.lead}>
          <b className={styles.email}>{user?.email}</b>으로 보낸 6자리 숫자를 입력해 주세요.
        </p>

        {status.isPending && <Skeleton count={2} />}
        {status.isError && (
          <p role="alert" className={styles.formError}>
            인증 상태를 불러오지 못했어요.{' '}
            <button type="button" className={styles.linkButton} onClick={() => void status.refetch()}>
              다시 시도
            </button>
          </p>
        )}
        {times && !status.data?.verified && (
          <CodeStep
            initial={times}
            autoFocus
            check={async (code) => {
              const me = await verificationApi.confirm(code)
              queryClient.setQueryData(ME_QUERY_KEY, me)
              showToast('이메일 인증을 마쳤어요')
            }}
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
        {status.data?.verified && (
          <p className={styles.lead}>
            이미 인증을 마쳤어요.{' '}
            <button type="button" className={styles.linkButton} onClick={alreadyVerified}>
              시작하기
            </button>
          </p>
        )}

        <p className={styles.hint}>메일이 안 왔나요? 스팸함을 확인하거나 새 코드를 받아 주세요.</p>
        {/* 주소를 잘못 써서 메일을 받을 수 없는 사용자가 빠져나갈 길 */}
        <p className={styles.hint}>
          다른 이메일로 가입했나요?{' '}
          <button
            type="button"
            className={styles.linkButton}
            aria-disabled={leaving}
            onClick={() => !leaving && signOut()}
          >
            로그아웃
          </button>
        </p>
      </div>
    </AuthLayout>
  )
}

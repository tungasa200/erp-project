// SCR-SYS-02 오류 페이지: 화면을 그리다 실패했을 때 라우터가 보여 준다.
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ApiError } from '../api/problem'
import { CopyCodeButton } from '../components/CopyCodeButton'
import { NotFoundPage } from './NotFoundPage'
import styles from './system.module.css'

export function ErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  const traceId = error instanceof ApiError ? error.traceId : undefined

  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <span className={`${styles.icon} ${styles.iconDanger}`} aria-hidden="true">
          !
        </span>
        <h1 className={styles.title}>잠시 문제가 생겼어요</h1>
        <p className={styles.text}>잠시 후 다시 시도해 주세요.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            다시 시도
          </button>
        </div>
        {traceId && (
          <>
            <CopyCodeButton code={traceId} />
            <span className={styles.hint}>문의할 때 이 코드를 알려 주세요</span>
          </>
        )}
      </div>
    </main>
  )
}

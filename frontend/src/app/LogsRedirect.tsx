// 업무일지 숨김(사용자 결정 2026-10-12): 일지 화면(logs/LogListPage·LogPage)은 지우지 않고 길만 막는다.
// 예전 링크·북마크는 홈으로, 하루 마감 푸시(/logs/daily/{date}?close=1, 백엔드 그대로)는 홈에서 그날 마감 창을 연다(AppShell이 ?close=날짜를 본다)
import { Navigate, useParams, useSearchParams } from 'react-router'

export function LogsRedirect() {
  const rest = useParams()['*'] ?? ''
  const [params] = useSearchParams()
  const daily = /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(rest)
  return <Navigate to={daily && params.get('close') === '1' ? `/?close=${daily[1]}` : '/'} replace />
}

// 화면 오류 수집 (P4-13, NFR-09, D-175 ②·D-177 ①). POST /api/client-errors — gateway가 로그 한 줄로만 남긴다.
// 오류 객체의 message·stack과 화면 주소(쿼리·# 뺌)만 보낸다. 입력값·토큰·응답 본문은 넣지 않는다.
// 같은 오류(message + stack 첫 줄)는 한 페이지 수명 동안 한 번만, 실패해도 다시 보내지 않는다(수집이 오류를 만들지 않게).
// 서버 요청 제한(IP당 1분 10건)을 넘지 않도록 한 페이지에서 10건까지만 보낸다.

export type ClientErrorKind = 'ERROR' | 'UNHANDLED_REJECTION' | 'RENDER'

const ENDPOINT = '/api/client-errors'
const MAX_PER_PAGE = 10
const TRACE_ID = /^[0-9a-f]{16,32}$/

const sent = new Set<string>()
let lastFailedTraceId: string | undefined

/** API 응답이 실패했을 때 그 traceId를 기억해 다음 오류 보고에 붙인다(서버 로그와 잇기) */
export function noteFailedTraceId(traceId: string | null | undefined) {
  if (traceId && TRACE_ID.test(traceId)) lastFailedTraceId = traceId
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || reason.name, stack: reason.stack }
  // 문자열이 아닌 값(객체 등)은 내용에 입력값이 들어 있을 수 있어 종류만 남긴다
  return { message: typeof reason === 'string' ? reason : `Non-Error ${Object.prototype.toString.call(reason)}` }
}

export function reportClientError(kind: ClientErrorKind, reason: unknown) {
  // 백엔드 없이 보는 mock 모드에서는 보낼 곳이 없다
  if (import.meta.env.VITE_API_MOCK === 'true') return
  const { message, stack } = describe(reason)
  const key = `${message}\n${stack?.split('\n')[0] ?? ''}`
  if (sent.has(key) || sent.size >= MAX_PER_PAGE) return
  sent.add(key)
  const body = {
    kind,
    message: message.slice(0, 500),
    stack: stack?.slice(0, 4000),
    url: (window.location.origin + window.location.pathname).slice(0, 300),
    release: import.meta.env.VITE_RELEASE as string | undefined,
    relatedTraceId: lastFailedTraceId,
  }
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 쿠키는 보내지 않는다(서버도 읽지 않음). 화면을 떠나는 중에도 보내지게 keepalive
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // fetch 자체가 없거나 막힌 환경: 무시
  }
}

/** window error·unhandledrejection을 받아 보낸다. 앱 시작 때 한 번 부른다 */
export function installClientErrorReporting() {
  window.addEventListener('error', (event) => {
    // 이미지·스크립트 불러오기 실패(리소스 오류)는 error 객체가 없다. 화면 코드 오류만 보낸다
    if (event.error === undefined && !event.message) return
    reportClientError('ERROR', event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => reportClientError('UNHANDLED_REJECTION', event.reason))
}

/** 시험용: 페이지 수명 상태를 비운다 */
export function resetClientErrorsForTest() {
  sent.clear()
  lastFailedTraceId = undefined
}

import { ApiError, NetworkError } from './problem'

// 화면이 따로 처리하지 않는 오류를 토스트 문구로 바꾼다 (화면정의서 2.5, D-35).
export function toastForError(error: unknown): { message: string; traceId?: string } {
  if (error instanceof NetworkError) return { message: '연결이 끊겼어요. 연결을 확인하고 다시 시도해 주세요' }
  if (error instanceof ApiError && error.status >= 500) {
    return { message: '잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요', traceId: error.traceId }
  }
  return {
    message: '요청을 처리하지 못했어요. 다시 시도해 주세요',
    traceId: error instanceof ApiError ? error.traceId : undefined,
  }
}

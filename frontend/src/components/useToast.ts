import { createContext, useContext } from 'react'

export interface UndoOptions {
  /** 같은 group의 동작이 토스트가 떠 있는 동안 이어지면 토스트 하나로 합친다 (예: 3개 삭제) */
  group: string
  message: (count: number) => string
  undo: () => void | Promise<void>
  /** 되돌리지 않고 토스트가 닫힐 때(시간 끝, 닫기, 다른 동작의 토스트로 바뀜) 실행한다.
   *  되돌릴 수 없는 API(태그·일정 삭제)는 이때 보낸다(P1-02 결정 A안). 새로 고침·탭 닫기·탭 숨김에서도
   *  한 번만 실행하며, 그때는 keepalive=true이므로 요청에 keepalive를 넘겨야 끝까지 간다(P1-02-07) */
  commit?: (options: { keepalive: boolean }) => void
  /** 메시지와 [되돌리기] 사이의 이동 링크(예: 복원한 업무 '보기'). 누르면 토스트를 닫아 동작을 확정하고 그 화면으로 간다.
   *  같은 group으로 합쳐져 2건 이상이 되면 보이지 않는다 */
  view?: { label: string; to: string }
}

export interface ToastValue {
  showToast: (message: string, options?: { traceId?: string }) => void
  /** SCR-COM-04 되돌리기 토스트. 일지 확정 해제·회원 탈퇴·원본에서 다시 채우기는 확인창을 쓴다(UX-03) */
  showUndo: (options: UndoOptions) => void
}

export const ToastContext = createContext<ToastValue | null>(null)

export function useToast(): ToastValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}

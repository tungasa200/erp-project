import { createContext, useContext } from 'react'

export interface UndoOptions {
  /** 같은 group의 동작이 토스트가 떠 있는 동안 이어지면 토스트 하나로 합친다 (예: 3개 삭제) */
  group: string
  message: (count: number) => string
  undo: () => void | Promise<void>
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

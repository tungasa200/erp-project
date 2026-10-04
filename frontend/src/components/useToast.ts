import { createContext, useContext } from 'react'

export interface ToastValue {
  showToast: (message: string, options?: { traceId?: string }) => void
}

export const ToastContext = createContext<ToastValue | null>(null)

export function useToast(): ToastValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}

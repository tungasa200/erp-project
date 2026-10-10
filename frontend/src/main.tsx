/// <reference types="vite-plugin-pwa/vanillajs" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import { setSessionExpiredHandler } from './api'
import { installClientErrorReporting } from './api/clientErrors'
import { MaintenanceGate } from './app/MaintenanceGate'
import { router } from './app/router'
import { AuthProvider } from './auth/AuthContext'
import { handleSessionExpired } from './auth/session'
import { AppFrame } from './components/AppFrame'
import { ToastProvider } from './components/Toast'
import './theme/global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

// 화면 오류 수집(P4-13): 처리되지 않은 오류를 gateway 로그로 보낸다
installClientErrorReporting()

// 서비스 워커(P4-03). 개발 서버에서는 플러그인이 빈 함수를 줘서 등록하지 않는다
registerSW({ immediate: true })

setSessionExpiredHandler((code) => handleSessionExpired(queryClient, code))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppFrame>
          <MaintenanceGate router={router}>
            <ToastProvider navigate={(to) => void router.navigate(to)}>
              <RouterProvider router={router} />
            </ToastProvider>
          </MaintenanceGate>
        </AppFrame>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { setSessionExpiredHandler } from './api'
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

setSessionExpiredHandler((code) => handleSessionExpired(queryClient, code))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppFrame>
          <MaintenanceGate router={router}>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </MaintenanceGate>
        </AppFrame>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)

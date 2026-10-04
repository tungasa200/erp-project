import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { setSessionExpiredHandler } from './api'
import { router } from './app/router'
import { AuthProvider } from './auth/AuthContext'
import { handleSessionExpired } from './auth/session'
import { ToastProvider } from './components/Toast'
import './theme/global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

setSessionExpiredHandler(() => handleSessionExpired(queryClient))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)

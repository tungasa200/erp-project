import { createBrowserRouter } from 'react-router'
import { AppShell } from '../components/AppShell'
import { GuestOnly, RequireAuth } from './guards'
import { ErrorPage } from '../pages/ErrorPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { SignupPage } from '../pages/SignupPage'

export const routes = [
  {
    errorElement: <ErrorPage />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/signup', element: <SignupPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <HomePage /> },
              { path: '/calendar', element: <PlaceholderPage title="캘린더" /> },
              { path: '/tasks', element: <PlaceholderPage title="업무" /> },
              { path: '/logs', element: <PlaceholderPage title="업무일지" /> },
              { path: '/stats', element: <PlaceholderPage title="통계" /> },
              { path: '/settings', element: <PlaceholderPage title="설정" /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
